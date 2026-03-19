require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { createClient } = require('@supabase/supabase-js');

const SERVER_START = Date.now();
const { scoreNotification, generateDraft } = require('./scorer');
const { updateFromFeedback, generateOptimisationSuggestions, loadProfile } = require('./ml');
const { verifyWebhook, validateSignature, parseWebhookEvent, sendManagedAbsenceReply } = require('./integrations/whatsapp');
const {
  getAuthUrl: gmailAuthUrl,
  exchangeCode: gmailExchange,
  getEmailAddress: gmailGetEmailAddress,
  fetchUnreadEmails,
  sendReply: gmailSendReply,
  applyGmailLabel,
  starMessage: gmailStarMessage,
  setupWatch: gmailSetupWatch,
  stopWatch: gmailStopWatch,
  getNewMessagesSinceHistory
} = require('./integrations/gmail');
const { decodePubSubMessage, verifyPubSubToken } = require('./services/gmail-pubsub');
const { enrichLinkedInNotification } = require('./integrations/linkedin');

const app = express();

// Security headers (7.x)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));

app.use(cors());

// Raw body capture for WhatsApp HMAC validation — must come before express.json() (2.3.5)
app.use((req, res, next) => {
  if (req.path === '/integrations/whatsapp/webhook' && req.method === 'POST') {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      req.rawBody = raw;
      try { req.body = JSON.parse(raw); } catch { req.body = {}; }
      next();
    });
  } else {
    next();
  }
});

app.use(express.json());
app.use(morgan('[:date[iso]] :method :url :status :response-time ms'));

// ── Rate limiting (7.5.3) ─────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 120,                  // 120 req/min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' }
});
const feedbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many feedback submissions.' }
});
const testLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many test injections.' }
});
app.use(generalLimiter);

// ── IDOR helper (7.5.1) ───────────────────────────────────────────
// Verify that a resource row belongs to the requesting user_id.
async function assertOwnership(table, id, userId) {
  const { data } = await supabase.from(table).select('user_id').eq('id', id).single();
  if (!data || data.user_id !== userId) {
    const err = new Error('Not found or access denied.');
    err.status = 403;
    throw err;
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── Health ────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const uptimeSec = Math.floor((Date.now() - SERVER_START) / 1000);
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime_seconds: uptimeSec,
    time: new Date().toISOString(),
    services: {
      groq:           !!process.env.GROQ_API_KEY,
      gmail:          !!process.env.GMAIL_CLIENT_ID,
      whatsapp:       !!process.env.WHATSAPP_TOKEN,
      whatsapp_hmac:  !!process.env.WHATSAPP_APP_SECRET,
      supabase:       !!process.env.SUPABASE_URL
    }
  });
});

// ── Core ingestion ────────────────────────────────────────────────
async function ingestNotification(raw, userId) {
  // Enrich LinkedIn emails from Gmail
  if (raw.source === 'email' && /linkedin\.com/i.test(raw.sender_domain || '')) {
    raw = enrichLinkedInNotification(raw);
  }

  // Deduplication: skip if source_id already exists for this user (2.1.8)
  if (raw.source_id && !raw.source_id.startsWith('test-')) {
    const { data: existing } = await supabase
      .from('notification_metadata')
      .select('id')
      .eq('user_id', userId)
      .eq('source_id', raw.source_id)
      .limit(1);
    if (existing?.length > 0) {
      console.log(`[INGEST] Duplicate skipped: ${raw.source_id}`);
      return { skipped: true, id: existing[0].id };
    }
  }

  const { score, baseScore, reason, tier, source: scorerSource } = await scoreNotification(raw, userId, supabase);

  // Read per-user routing thresholds (3.2.5); fall back to system defaults
  let thresholdInterrupt = 7;
  let thresholdQueue = 5;
  if (userId) {
    const { data: mlRow } = await supabase
      .from('user_ml_profile')
      .select('threshold_interrupt, threshold_queue')
      .eq('user_id', userId)
      .single();
    if (mlRow?.threshold_interrupt) thresholdInterrupt = mlRow.threshold_interrupt;
    if (mlRow?.threshold_queue) thresholdQueue = mlRow.threshold_queue;
  }

  const actionTaken = score >= thresholdInterrupt ? 'interrupt'
    : score >= thresholdQueue ? 'queued'
    : 'suppressed';

  const { data: meta, error } = await supabase
    .from('notification_metadata')
    .insert({
      user_id: userId,
      source_id: raw.source_id || `${raw.source}-${Date.now()}`,
      source: raw.source,
      notification_type: raw.notification_type,
      sender_domain: raw.sender_display || raw.sender_domain || '',
      received_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      final_score: score,
      action_taken: actionTaken,
      retention_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    })
    .select().single();

  if (error) {
    console.error('DB insert error:', error.message);
    return { error: error.message };
  }

  await supabase.from('message_excerpts').insert({
    user_id: userId,
    source_metadata_id: meta.id,
    encrypted_excerpt: (raw.body || '').slice(0, 300),
    urgency_score: score,
    sender_id: raw.sender_display || 'unknown',
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  });

  console.log(`[INGEST] ${raw.source}/${raw.notification_type} → ${score} (${tier}) via ${scorerSource} — ${reason}`);
  return { id: meta.id, score, baseScore, tier, reason };
}

// ── WhatsApp webhook ──────────────────────────────────────────────
app.get('/integrations/whatsapp/webhook', (req, res) => {
  const challenge = verifyWebhook(req.query);
  if (challenge) res.status(200).send(challenge);
  else res.sendStatus(403);
});

app.post('/integrations/whatsapp/webhook', async (req, res) => {
  // HMAC signature validation (2.3.5)
  if (!validateSignature(req.rawBody || '', req.headers['x-hub-signature-256'])) {
    console.warn('[WA] Invalid webhook signature — rejecting');
    return res.sendStatus(403);
  }
  res.sendStatus(200); // Acknowledge immediately

  const notification = parseWebhookEvent(req.body);
  if (!notification) return;

  // Find the user linked to this WhatsApp number (via user_integrations)
  const { data: integration } = await supabase
    .from('user_integrations')
    .select('user_id, settings')
    .eq('integration_type', 'whatsapp')
    .eq('is_enabled', true)
    .single();

  if (!integration) return;

  // WhatsApp URGENT keyword re-escalation (3.3.8)
  // If the sender replies "URGENT", force the notification to critical tier
  if (/^\s*urgent\s*$/i.test(notification.body || '')) {
    notification.title = `URGENT: WhatsApp from ${notification.sender_display}`;
    notification.body  = `URGENT escalation from ${notification.sender_display}`;
  }

  const { id, score, tier } = await ingestNotification(notification, integration.user_id);

  // Check if user is in an active focus session
  const { data: session } = await supabase
    .from('focus_sessions')
    .select('id, started_at, duration_minutes')
    .eq('user_id', integration.user_id)
    .is('ended_at', null)
    .single();

  // Send managed absence reply for non-critical messages
  if (session && score < 9 && process.env.WHATSAPP_TOKEN) {
    const sessionEnd = session.started_at
      ? new Date(new Date(session.started_at).getTime() + (session.duration_minutes || 60) * 60000)
      : null;
    try {
      await sendManagedAbsenceReply(notification._meta.from, notification.sender_display, sessionEnd, score);
    } catch (e) {
      console.error('WhatsApp auto-reply failed:', e.message);
    }
  }
});

// ── Gmail OAuth ───────────────────────────────────────────────────
app.get('/integrations/gmail/connect', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!process.env.GMAIL_CLIENT_ID) return res.status(503).json({ error: 'Gmail not configured on server' });
  res.redirect(gmailAuthUrl(user_id));
});

app.get('/integrations/gmail/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (!code || !userId) {
    return res.redirect(`${FRONTEND}?integration=gmail&status=error&msg=Missing+code+or+user`);
  }

  try {
    const tokens = await gmailExchange(code);

    const row = {
      user_id: userId,
      integration_type: 'email',
      is_enabled: true,
      credentials: { tokens },
      settings: { provider: 'gmail' },
      status: 'connected',
      last_synced_at: new Date().toISOString()
    };

    // Check if a row already exists for this user + integration_type
    const { data: existing } = await supabase
      .from('user_integrations')
      .select('id')
      .eq('user_id', userId)
      .eq('integration_type', 'email')
      .maybeSingle();

    let dbError;
    if (existing) {
      const { error } = await supabase
        .from('user_integrations')
        .update({ is_enabled: true, credentials: { tokens }, settings: { provider: 'gmail' }, status: 'connected', last_synced_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('integration_type', 'email');
      dbError = error;
    } else {
      const { error } = await supabase.from('user_integrations').insert(row);
      dbError = error;
    }

    if (dbError) {
      console.error('[GMAIL] Callback DB error:', dbError.message);
      return res.redirect(`${FRONTEND}?integration=gmail&status=error&msg=${encodeURIComponent(dbError.message)}`);
    }

    console.log(`[GMAIL] Integration saved for user ${userId}`);
    res.redirect(`${FRONTEND}?integration=gmail&status=connected`);
  } catch (e) {
    console.error('[GMAIL] Callback error:', e.message);
    res.redirect(`${FRONTEND}?integration=gmail&status=error&msg=${encodeURIComponent(e.message)}`);
  }
});

// Poll Gmail for a user (called when session starts)
app.post('/integrations/gmail/poll', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data: integration } = await supabase
    .from('user_integrations')
    .select('credentials')
    .eq('user_id', user_id)
    .eq('integration_type', 'email')
    .single();

  if (!integration) return res.status(404).json({ error: 'Gmail not connected' });

  try {
    const { emails, refreshedTokens } = await fetchUnreadEmails(integration.credentials.tokens);

    // Persist refreshed tokens if the OAuth library silently renewed them (2.2.8)
    if (refreshedTokens) {
      await supabase.from('user_integrations')
        .update({ credentials: { tokens: refreshedTokens } })
        .eq('user_id', user_id).eq('integration_type', 'email');
    }

    // Check for active session to determine whether to auto-reply (3.4.4)
    const { data: activeSession } = await supabase
      .from('focus_sessions')
      .select('id, started_at, duration_minutes')
      .eq('user_id', user_id)
      .is('ended_at', null)
      .limit(1)
      .maybeSingle();

    const results = await Promise.all(emails.map(async (email) => {
      const result = await ingestNotification(email, user_id);
      const currentTokens = refreshedTokens || integration.credentials.tokens;

      // Apply Gmail label based on urgency score (SENTINEL/URGENT|REVIEW|SUPPRESSED)
      if (!result.skipped && email.id && result.score != null) {
        await applyGmailLabel(currentTokens, email.id, result.score, user_id);
        // Star critical emails (score ≥ 9) for extra visibility
        if (result.score >= 9) {
          await gmailStarMessage(currentTokens, email.id);
        }
      }

      // Auto-reply for non-critical emails during an active session (3.4.4)
      if (activeSession && result.score !== undefined && result.score < 9 && !result.skipped) {
        const sessionEnd = activeSession.started_at
          ? new Date(new Date(activeSession.started_at).getTime() + (activeSession.duration_minutes || 60) * 60000)
          : null;
        const endStr = sessionEnd
          ? `I'll be back around ${sessionEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
          : "I'll follow up shortly.";
        const replyText = `Thanks for your message. I'm currently in a deep focus session — ${endStr}\n\n— Sentinel Auto-Reply`;
        try {
          const replyResult = await gmailSendReply(currentTokens, email.threadId, email.raw_from, replyText, {
            subject: email.title,
            originalMessageId: email.gmailMessageId
          });
          if (!replyResult.skipped) {
            // Log the auto-reply
            await supabase.from('auto_response_drafts').insert({
              user_id,
              notification_id: result.id,
              target_platform: 'email',
              encrypted_draft: replyText,
              template_used: 'managed_absence',
              status: 'sent',
              response_tier: result.score >= 5 ? 2 : 3,
              expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            });
          }
        } catch (replyErr) {
          console.warn('[GMAIL] Auto-reply failed:', replyErr.message);
        }
      }

      return result;
    }));

    await supabase.from('user_integrations').update({ last_synced_at: new Date().toISOString() })
      .eq('user_id', user_id).eq('integration_type', 'email');
    res.json({ processed: results.length, results });
  } catch (e) {
    // 2.2.9 — graceful error: don't crash the session on poll failure
    console.error('[GMAIL] Poll error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Feedback endpoint (trains ML model) ──────────────────────────
app.post('/feedback', feedbackLimiter, async (req, res) => {
  const { user_id, notification_id, rating, response_time_seconds } = req.body;
  if (!user_id || !rating) return res.status(400).json({ error: 'user_id and rating required' });

  // Fetch original notification for features
  const { data: notification } = await supabase
    .from('notification_metadata')
    .select('*')
    .eq('id', notification_id)
    .single();

  if (!notification) return res.status(404).json({ error: 'Notification not found' });

  // IDOR: ensure notification belongs to this user (7.5.1)
  if (notification.user_id !== user_id) return res.status(403).json({ error: 'Access denied.' });

  const updatedProfile = await updateFromFeedback(user_id, notification, rating, response_time_seconds, supabase);
  const accuracy = updatedProfile.total_interactions > 0
    ? Math.round((updatedProfile.correct_predictions / updatedProfile.total_interactions) * 100)
    : 0;

  res.json({
    success: true,
    total_interactions: updatedProfile.total_interactions,
    accuracy_pct: accuracy
  });
});

// ── Role keyword defaults (1.4.7) ─────────────────────────────────
const ROLE_KEYWORD_DEFAULTS = {
  developer:    ['bug', 'deploy', 'build', 'review', 'merge', 'production', 'incident', 'outage'],
  manager:      ['deadline', 'report', 'approval', 'budget', 'client', 'escalation', 'meeting'],
  designer:     ['feedback', 'review', 'mockup', 'deadline', 'client', 'iteration'],
  professional: ['urgent', 'deadline', 'meeting', 'client', 'follow-up', 'contract'],
  student:      ['assignment', 'exam', 'deadline', 'grade', 'professor', 'submission']
};

function seedKeywordWeights(role, userKeywords = []) {
  const defaults = ROLE_KEYWORD_DEFAULTS[role] || ROLE_KEYWORD_DEFAULTS.professional;
  const weights = {};
  defaults.forEach(kw => { weights[kw] = 1.3; }); // slight boost for role-relevant terms
  userKeywords.forEach(kw => { weights[kw.toLowerCase()] = 1.5; }); // user-specified get higher boost
  return weights;
}

// ── Onboarding ────────────────────────────────────────────────────
app.post('/onboarding', async (req, res) => {
  const { user_id, role, vip_senders, focus_keywords, focus_hours_start, focus_hours_end, auto_reply_enabled } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  // Normalise to lowercase so it matches ROLE_KEYWORD_DEFAULTS keys
  const resolvedRole = (role || 'professional').toLowerCase().replace(/\s+/g, '_');

  await supabase.from('user_onboarding').upsert({
    user_id,
    role: resolvedRole,
    vip_senders: vip_senders || [],
    focus_keywords: focus_keywords || [],
    focus_hours_start: focus_hours_start ?? 9,
    focus_hours_end: focus_hours_end ?? 17,
    auto_reply_enabled: auto_reply_enabled ?? true,
    completed: true
  }, { onConflict: 'user_id' });

  // Seed ML profile with onboarding data + role-based keyword weights (1.4.7)
  await supabase.from('user_ml_profile').upsert({
    user_id,
    role: resolvedRole,
    vip_senders: vip_senders || [],
    focus_keywords: focus_keywords || [],
    sender_weights: {},
    keyword_weights: seedKeywordWeights(resolvedRole, focus_keywords),
    source_weights: { email: 1.0, whatsapp: 1.0, linkedin: 1.0 },
    time_weights: { morning: 1.0, afternoon: 1.0, evening: 1.0 },
    blocked_senders: [],
    total_interactions: 0,
    correct_predictions: 0
  }, { onConflict: 'user_id' });

  res.json({ success: true });
});

app.get('/onboarding/:userId', async (req, res) => {
  const { data } = await supabase.from('user_onboarding').select('*').eq('user_id', req.params.userId).single();
  res.json(data || { completed: false });
});

// ── ML profile & suggestions ──────────────────────────────────────
app.get('/ml/profile/:userId', async (req, res) => {
  const { data: profile } = await supabase.from('user_ml_profile').select('*').eq('user_id', req.params.userId).single();
  const { data: recent } = await supabase.from('notification_metadata').select('source').eq('user_id', req.params.userId).order('received_at', { ascending: false }).limit(50);
  const suggestions = generateOptimisationSuggestions(profile, recent || []);
  const accuracy = profile?.total_interactions > 0
    ? Math.round((profile.correct_predictions / profile.total_interactions) * 100)
    : null;
  res.json({ profile, suggestions, accuracy_pct: accuracy });
});

// ── Integration status ────────────────────────────────────────────
app.get('/integrations/:userId', async (req, res) => {
  const { data } = await supabase.from('user_integrations').select('integration_type,is_enabled,status,last_synced_at').eq('user_id', req.params.userId);
  res.json(data || []);
});

// ── Disconnect an integration (5.4.6) ─────────────────────────────
app.delete('/integrations/:userId/:type', async (req, res) => {
  const { userId, type } = req.params;
  const { error } = await supabase
    .from('user_integrations')
    .update({ is_enabled: false, status: 'disconnected' })
    .eq('user_id', userId)
    .eq('integration_type', type);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Test injection (demo) ─────────────────────────────────────────
app.post('/test/inject', testLimiter, async (req, res) => {
  const { user_id, source, notification_type, title, body, sender } = req.body;
  if (!user_id || !source) return res.status(400).json({ error: 'user_id and source required' });

  const result = await ingestNotification({
    source,
    source_id: `test-${Date.now()}`,
    notification_type: notification_type || 'test',
    sender_display: sender || 'test-user',
    title: title || 'Test notification',
    body: body || 'This is a test notification.'
  }, user_id);

  res.json(result);
});

// ── Rules update ──────────────────────────────────────────────────
app.patch('/ml/profile/:userId/rules', async (req, res) => {
  const { vip_senders, blocked_senders, priority_keywords, auto_reply_enabled,
          threshold_interrupt, threshold_queue } = req.body;
  const updates = {};
  if (Array.isArray(vip_senders)) updates.vip_senders = vip_senders;
  if (Array.isArray(blocked_senders)) updates.blocked_senders = blocked_senders;
  if (Array.isArray(priority_keywords)) updates.priority_keywords = priority_keywords;
  if (typeof auto_reply_enabled === 'boolean') updates.auto_reply_enabled = auto_reply_enabled;
  // Per-user score thresholds (3.2.5)
  if (typeof threshold_interrupt === 'number') updates.threshold_interrupt = Math.min(10, Math.max(5, threshold_interrupt));
  if (typeof threshold_queue === 'number') updates.threshold_queue = Math.min(8, Math.max(2, threshold_queue));

  const { error } = await supabase
    .from('user_ml_profile')
    .update(updates)
    .eq('user_id', req.params.userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Notifications for a specific session window (6.3.8) ──────────
app.get('/sessions/:sessionId/notifications', async (req, res) => {
  const { sessionId } = req.params;
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data: session } = await supabase
    .from('focus_sessions')
    .select('user_id, started_at, ended_at')
    .eq('id', sessionId)
    .single();

  if (!session || session.user_id !== user_id) {
    return res.status(403).json({ error: 'Not found or access denied.' });
  }

  const endTime = session.ended_at || new Date().toISOString();
  const { data } = await supabase
    .from('notification_metadata')
    .select('id, source, notification_type, sender_domain, final_score, action_taken, received_at')
    .eq('user_id', user_id)
    .gte('received_at', session.started_at)
    .lte('received_at', endTime)
    .order('final_score', { ascending: false })
    .limit(50);

  res.json(data || []);
});

// ── Data retention cleanup (1.1.7) ───────────────────────────────
// Deletes rows past their retention_until / expires_at date.
// Call this from a scheduled job or manually via POST /admin/cleanup.
app.post('/admin/cleanup', async (req, res) => {
  const now = new Date().toISOString();
  const [notifs, excerpts, drafts] = await Promise.all([
    supabase.from('notification_metadata').delete().lt('retention_until', now),
    supabase.from('message_excerpts').delete().lt('expires_at', now),
    supabase.from('auto_response_drafts').delete().lt('expires_at', now)
  ]);
  res.json({
    notifications_deleted: notifs.count ?? 0,
    excerpts_deleted: excerpts.count ?? 0,
    drafts_deleted: drafts.count ?? 0
  });
});

// ── Session draft generation (6.2.2 / 6.2.3) ─────────────────────
app.post('/session/drafts', async (req, res) => {
  const { user_id, notification_ids } = req.body;
  if (!user_id || !Array.isArray(notification_ids) || notification_ids.length === 0) {
    return res.status(400).json({ error: 'user_id and notification_ids[] required' });
  }

  // .eq('user_id', user_id) already scopes to the requesting user (IDOR guard, 7.5.1)
  const { data: notifications } = await supabase
    .from('notification_metadata')
    .select('id, notification_type, sender_domain, source, message_excerpts(encrypted_excerpt)')
    .in('id', notification_ids)
    .eq('user_id', user_id);

  if (!notifications?.length) return res.status(404).json({ error: 'No notifications found' });

  const drafts = await Promise.all(notifications.map(async (n) => {
    const excerpt = n.message_excerpts?.[0]?.encrypted_excerpt || '';
    const aiDraft = await generateDraft(n.notification_type, n.sender_domain, excerpt);
    const draft = aiDraft || `Thanks for reaching out. I was in a focus session and will follow up shortly regarding "${n.notification_type}".`;
    return {
      notification_id: n.id,
      draft,
      source: n.source,
      sender: n.sender_domain,
      title: n.notification_type,
      excerpt
    };
  }));

  res.json({ drafts });
});

// ── Session optimization suggestions (4.5.4 / 6.3.4) ─────────────
app.get('/ml/suggestions/:userId', async (req, res) => {
  const { data: profile } = await supabase.from('user_ml_profile').select('*').eq('user_id', req.params.userId).single();
  const { data: recent } = await supabase.from('notification_metadata').select('source').eq('user_id', req.params.userId).order('received_at', { ascending: false }).limit(50);
  const suggestions = generateOptimisationSuggestions(profile, recent || []);
  res.json({ suggestions });
});

// ── Record a sent draft (6.2.4 / 6.2.5) ──────────────────────────
app.post('/session/drafts/send', async (req, res) => {
  const { user_id, notification_id, draft_text, target_platform, tier } = req.body;
  if (!user_id || !notification_id) return res.status(400).json({ error: 'user_id and notification_id required' });

  const { error } = await supabase.from('auto_response_drafts').insert({
    user_id,
    notification_id,
    target_platform: target_platform || 'email',
    encrypted_draft: draft_text || '',
    template_used: 'ai_generated',
    status: 'sent',
    response_tier: tier || 2,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Gmail Pub/Sub watch setup ──────────────────────────────────────
// Tells Gmail to push new-mail events to our Pub/Sub topic.
// Call this once after a user connects Gmail, and again every 7 days to renew.
app.post('/integrations/gmail/watch/setup', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const topicName = process.env.PUBSUB_TOPIC;
  if (!topicName) return res.status(503).json({ error: 'PUBSUB_TOPIC not configured' });

  const { data: integration } = await supabase
    .from('user_integrations')
    .select('credentials, settings')
    .eq('user_id', user_id)
    .eq('integration_type', 'email')
    .single();

  if (!integration) return res.status(404).json({ error: 'Gmail not connected' });

  try {
    const { historyId, expiration, refreshedTokens } = await gmailSetupWatch(
      integration.credentials.tokens,
      topicName
    );

    // Persist historyId + expiration so the Pub/Sub handler knows where to start
    const updatedSettings = {
      ...(integration.settings || {}),
      watch_history_id: historyId,
      watch_expiration: expiration,
      email_address: await gmailGetEmailAddress(integration.credentials.tokens)
    };
    const updatedCreds = refreshedTokens
      ? { tokens: refreshedTokens }
      : integration.credentials;

    await supabase.from('user_integrations')
      .update({ settings: updatedSettings, credentials: updatedCreds })
      .eq('user_id', user_id).eq('integration_type', 'email');

    res.json({ ok: true, historyId, expiration });
  } catch (e) {
    console.error('[GMAIL] Watch setup error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Gmail Pub/Sub watch teardown ───────────────────────────────────
app.delete('/integrations/gmail/watch/stop/:userId', async (req, res) => {
  const { userId } = req.params;
  const { data: integration } = await supabase
    .from('user_integrations')
    .select('credentials')
    .eq('user_id', userId)
    .eq('integration_type', 'email')
    .single();

  if (!integration) return res.status(404).json({ error: 'Gmail not connected' });

  try {
    await gmailStopWatch(integration.credentials.tokens);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Gmail Pub/Sub push endpoint ────────────────────────────────────
// Google Cloud Pub/Sub POSTs here whenever Gmail has a new inbox event.
// Payload: { message: { data: base64({"emailAddress","historyId"}), ... }, subscription }
app.post('/integrations/gmail/pubsub', async (req, res) => {
  // Verify the shared token to reject spoofed pushes
  if (!verifyPubSubToken(req.query.token)) {
    console.warn('[PUBSUB] Invalid verification token');
    return res.sendStatus(403);
  }

  // Acknowledge immediately — Google retries if it doesn't get 200 within 10s
  res.sendStatus(200);

  const notification = decodePubSubMessage(req.body);
  if (!notification?.emailAddress || !notification?.historyId) {
    console.warn('[PUBSUB] Malformed Pub/Sub message');
    return;
  }

  const { emailAddress, historyId: newHistoryId } = notification;
  console.log(`[PUBSUB] Push for ${emailAddress}, historyId=${newHistoryId}`);

  // Find the user whose Gmail account matches this email address
  const { data: integrations } = await supabase
    .from('user_integrations')
    .select('user_id, credentials, settings')
    .eq('integration_type', 'email')
    .eq('is_enabled', true);

  const integration = integrations?.find(i =>
    i.settings?.email_address?.toLowerCase() === emailAddress.toLowerCase()
  );

  if (!integration) {
    console.log(`[PUBSUB] No integration found for ${emailAddress}`);
    return;
  }

  const { user_id, credentials, settings } = integration;
  const storedHistoryId = settings?.watch_history_id;

  if (!storedHistoryId) {
    console.warn(`[PUBSUB] No stored historyId for user ${user_id} — skipping`);
    return;
  }

  try {
    const { messages, newHistoryId: updatedHistoryId, refreshedTokens } =
      await getNewMessagesSinceHistory(credentials.tokens, storedHistoryId);

    if (!messages.length) return;

    console.log(`[PUBSUB] Processing ${messages.length} new message(s) for user ${user_id}`);

    // Check for active session (to determine auto-reply and label behaviour)
    const { data: activeSession } = await supabase
      .from('focus_sessions')
      .select('id, started_at, duration_minutes')
      .eq('user_id', user_id)
      .is('ended_at', null)
      .limit(1)
      .maybeSingle();

    const currentTokens = refreshedTokens || credentials.tokens;

    for (const email of messages) {
      const result = await ingestNotification(email, user_id);

      // Apply Gmail label
      if (!result.skipped && email.id && result.score != null) {
        await applyGmailLabel(currentTokens, email.id, result.score, user_id);
        if (result.score >= 9) await gmailStarMessage(currentTokens, email.id);
      }

      // Auto-reply during focus session
      if (activeSession && result.score !== undefined && result.score < 9 && !result.skipped) {
        const sessionEnd = activeSession.started_at
          ? new Date(new Date(activeSession.started_at).getTime() + (activeSession.duration_minutes || 60) * 60000)
          : null;
        const endStr = sessionEnd
          ? `I'll be back around ${sessionEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
          : "I'll follow up shortly.";
        const replyText = `Thanks for your message. I'm currently in a deep focus session — ${endStr}\n\n— Sentinel Auto-Reply`;
        try {
          const replyResult = await gmailSendReply(currentTokens, email.threadId, email.raw_from, replyText, {
            subject: email.title,
            originalMessageId: email.gmailMessageId
          });
          if (!replyResult.skipped) {
            await supabase.from('auto_response_drafts').insert({
              user_id,
              notification_id: result.id,
              target_platform: 'email',
              encrypted_draft: replyText,
              template_used: 'managed_absence',
              status: 'sent',
              response_tier: result.score >= 5 ? 2 : 3,
              expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            });
          }
        } catch (e) {
          console.warn('[PUBSUB] Auto-reply error:', e.message);
        }
      }
    }

    // Advance the stored historyId so we don't reprocess the same messages
    if (updatedHistoryId) {
      const updatedSettings = { ...settings, watch_history_id: updatedHistoryId };
      const updatedCreds = refreshedTokens ? { tokens: refreshedTokens } : credentials;
      await supabase.from('user_integrations')
        .update({ settings: updatedSettings, credentials: updatedCreds, last_synced_at: new Date().toISOString() })
        .eq('user_id', user_id).eq('integration_type', 'email');
    }

  } catch (e) {
    console.error('[PUBSUB] Processing error:', e.message);
  }
});

// ── Watch renewal (Pub/Sub watches expire after 7 days) ────────────
// Runs daily and renews any watch expiring within the next 24 hours.
const renewGmailWatches = async () => {
  const topicName = process.env.PUBSUB_TOPIC;
  if (!topicName) return;

  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).getTime().toString();
  const { data: integrations } = await supabase
    .from('user_integrations')
    .select('user_id, credentials, settings')
    .eq('integration_type', 'email')
    .eq('is_enabled', true);

  if (!integrations?.length) return;

  for (const intg of integrations) {
    const expiration = intg.settings?.watch_expiration;
    if (!expiration || expiration > soon) continue; // not expiring soon

    try {
      const { historyId, expiration: newExpiry, refreshedTokens } =
        await gmailSetupWatch(intg.credentials.tokens, topicName);

      const updatedSettings = {
        ...(intg.settings || {}),
        watch_history_id: historyId,
        watch_expiration: newExpiry
      };
      await supabase.from('user_integrations')
        .update({
          settings: updatedSettings,
          ...(refreshedTokens ? { credentials: { tokens: refreshedTokens } } : {})
        })
        .eq('user_id', intg.user_id).eq('integration_type', 'email');

      console.log(`[GMAIL] Renewed watch for user ${intg.user_id}`);
    } catch (e) {
      console.warn(`[GMAIL] Watch renewal failed for user ${intg.user_id}:`, e.message);
    }
  }
};
// Check for expiring watches daily (offset from cleanup timer to spread load)
setTimeout(() => { renewGmailWatches(); setInterval(renewGmailWatches, 24 * 60 * 60 * 1000); }, 10 * 60 * 1000);

// ── Global error handler (1.3.5) ──────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', req.method, req.path, err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Daily retention cleanup (1.1.7) ──────────────────────────────
const runCleanup = async () => {
  const now = new Date().toISOString();
  const [n, e, d] = await Promise.all([
    supabase.from('notification_metadata').delete().lt('retention_until', now),
    supabase.from('message_excerpts').delete().lt('expires_at', now),
    supabase.from('auto_response_drafts').delete().lt('expires_at', now)
  ]);
  const total = (n.count ?? 0) + (e.count ?? 0) + (d.count ?? 0);
  if (total > 0) console.log(`[CLEANUP] Deleted ${total} expired rows`);
};
// Run once 5 minutes after startup, then every 24 hours
setTimeout(() => { runCleanup(); setInterval(runCleanup, 24 * 60 * 60 * 1000); }, 5 * 60 * 1000);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Sentinel server → http://localhost:${PORT}`);
  console.log(`Groq: ${process.env.GROQ_API_KEY ? 'enabled' : 'MISSING'} | Gmail: ${process.env.GMAIL_CLIENT_ID ? 'enabled' : 'not configured'} | WhatsApp: ${process.env.WHATSAPP_TOKEN ? 'enabled' : 'not configured'}`);
});
