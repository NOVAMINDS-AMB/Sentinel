/**
 * Gmail Integration — Production Grade
 *
 * Capabilities:
 *   - OAuth2 connect / token refresh
 *   - Full message body extraction (MIME tree, plain + HTML)
 *   - Gmail label management (SENTINEL/URGENT, SENTINEL/REVIEW, SENTINEL/SUPPRESSED)
 *   - Star critical emails
 *   - Auto-reply with proper threading headers + deduplication
 *   - Pub/Sub watch setup / teardown for near-real-time push
 *   - History-based message fetch (used by Pub/Sub webhook)
 *
 * Scopes required (gmail.modify is NEW vs. the original):
 *   gmail.readonly  — read messages / labels / history
 *   gmail.send      — send replies
 *   gmail.modify    — apply/remove labels, star, mark read
 *
 * NOTE: Existing users who connected before gmail.modify was added must
 *       reconnect via /integrations/gmail/connect to grant the new scope.
 *
 * Setup:
 *   1. console.cloud.google.com → project → Enable Gmail API
 *   2. OAuth consent screen → Scopes: gmail.readonly, gmail.send, gmail.modify
 *   3. Credentials → OAuth 2.0 Web Client → copy Client ID + Secret
 *   4. server/.env: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI
 *   5. (optional) For Pub/Sub push: PUBSUB_TOPIC, PUBSUB_VERIFY_TOKEN
 */

const { google } = require('googleapis');
const { Buffer } = require('buffer');

// ── OAuth scopes ──────────────────────────────────────────────────
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify'
];

// ── Sentinel label definitions ────────────────────────────────────
// Names use '/' to create a nested label group in Gmail UI
const SENTINEL_LABELS = {
  URGENT:     { name: 'SENTINEL/URGENT',     color: { backgroundColor: '#cc3a21', textColor: '#ffffff' } },
  REVIEW:     { name: 'SENTINEL/REVIEW',     color: { backgroundColor: '#f2c960', textColor: '#000000' } },
  SUPPRESSED: { name: 'SENTINEL/SUPPRESSED', color: { backgroundColor: '#b9b9b9', textColor: '#000000' } },
};

// Per-user label ID cache (in-memory, repopulated on restart from Gmail API)
// userId → { URGENT: 'Label_xxx', REVIEW: 'Label_yyy', SUPPRESSED: 'Label_zzz' }
const _labelCache = new Map();

// ── OAuth client factory ──────────────────────────────────────────
function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || 'http://localhost:3001/integrations/gmail/callback'
  );
}

// ── Auth: generate OAuth URL ──────────────────────────────────────
function getAuthUrl(userId) {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state: userId,
    prompt: 'consent' // force consent screen to always get refresh_token
  });
}

// ── Auth: exchange code for tokens ───────────────────────────────
async function exchangeCode(code) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// ── Build authenticated Gmail client ─────────────────────────────
// Returns { gmail, getRefreshedTokens }
// Call getRefreshedTokens() after any API call to check if tokens were silently renewed.
function buildGmailClient(tokens) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials(tokens);

  let refreshedTokens = null;
  oauth2Client.on('tokens', (newTokens) => {
    refreshedTokens = {
      ...tokens,
      access_token: newTokens.access_token,
      expiry_date: newTokens.expiry_date,
      ...(newTokens.refresh_token ? { refresh_token: newTokens.refresh_token } : {})
    };
  });

  return {
    gmail: google.gmail({ version: 'v1', auth: oauth2Client }),
    getRefreshedTokens: () => refreshedTokens
  };
}

// ── Fetch user's Gmail address (for Pub/Sub routing) ─────────────
async function getEmailAddress(tokens) {
  const { gmail } = buildGmailClient(tokens);
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.emailAddress;
}

// ── Fetch unread emails with full bodies ─────────────────────────
// Returns { emails: ParsedEmail[], refreshedTokens: object|null }
async function fetchUnreadEmails(tokens, maxResults = 10) {
  const { gmail, getRefreshedTokens } = buildGmailClient(tokens);

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread newer_than:1d',
    maxResults
  });

  const messages = listRes.data.messages || [];
  if (!messages.length) return { emails: [], refreshedTokens: getRefreshedTokens() };

  // Fetch full messages (format: 'full' gives us the complete MIME payload)
  const full = await Promise.all(
    messages.map(m =>
      gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' })
    )
  );

  const emails = full.map(res => parseGmailMessage(res.data));
  return { emails, refreshedTokens: getRefreshedTokens() };
}

// ── Parse a raw Gmail message into Sentinel notification format ───
function parseGmailMessage(msg) {
  const headers = msg.payload?.headers || [];
  const get = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const from       = get('From');
  const subject    = get('Subject') || '(no subject)';
  const date       = get('Date');
  const messageId  = get('Message-ID');
  const inReplyTo  = get('In-Reply-To');
  const isLinkedIn = /linkedin\.com/i.test(from);

  const body    = extractBody(msg.payload);
  const snippet = msg.snippet || '';

  return {
    id:                msg.id,
    threadId:          msg.threadId,
    gmailMessageId:    messageId,     // original Message-ID header (for threading)
    source:            isLinkedIn ? 'linkedin' : 'email',
    source_id:         `gmail-${msg.id}`,
    notification_type: classifyEmailType(subject, from),
    sender_display:    extractSenderName(from),
    sender_domain:     extractDomain(from),
    raw_from:          from,
    title:             subject,
    body:              body || snippet,
    snippet,
    date,
    inReplyTo
  };
}

// ── MIME body extraction ──────────────────────────────────────────
// Recursively walks the MIME tree; prefers text/plain, falls back to text/html
function extractBody(payload, depth = 0) {
  if (!payload || depth > 8) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64url(payload.body.data).slice(0, 800);
  }

  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return stripHtml(decodeBase64url(payload.body.data)).slice(0, 800);
  }

  if (payload.parts?.length) {
    // Prefer plain text
    const plain = payload.parts.find(p => p.mimeType === 'text/plain');
    if (plain) {
      const text = extractBody(plain, depth + 1);
      if (text) return text;
    }
    // Fall back to HTML
    const html = payload.parts.find(p => p.mimeType === 'text/html');
    if (html) {
      const text = extractBody(html, depth + 1);
      if (text) return text;
    }
    // Recurse into nested multipart parts
    for (const part of payload.parts) {
      const text = extractBody(part, depth + 1);
      if (text) return text;
    }
  }

  return '';
}

function decodeBase64url(data) {
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Label management ──────────────────────────────────────────────

// Ensure all three Sentinel labels exist in the user's Gmail account.
// Returns { URGENT: id, REVIEW: id, SUPPRESSED: id }.
// Results are cached in memory; evict cache via invalidateLabelCache(userId).
async function ensureLabels(gmail, userId) {
  if (_labelCache.has(userId)) return _labelCache.get(userId);

  const { data } = await gmail.users.labels.list({ userId: 'me' });
  const existing = data.labels || [];
  const ids = {};

  for (const [key, def] of Object.entries(SENTINEL_LABELS)) {
    let label = existing.find(l => l.name === def.name);

    if (!label) {
      try {
        const created = await gmail.users.labels.create({
          userId: 'me',
          requestBody: {
            name: def.name,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show',
            color: def.color
          }
        });
        label = created.data;
        console.log(`[GMAIL] Created label: ${def.name} → ${label.id}`);
      } catch (e) {
        // Label may already exist under a different case, or color not supported
        console.warn(`[GMAIL] Label create warning for ${def.name}:`, e.message);
        // Try to find it again after the error
        label = existing.find(l => l.name.toLowerCase() === def.name.toLowerCase());
      }
    }

    if (label?.id) ids[key] = label.id;
  }

  _labelCache.set(userId, ids);
  return ids;
}

// Force reload labels from API (call after manual label changes)
function invalidateLabelCache(userId) {
  _labelCache.delete(userId);
}

// Apply the correct Sentinel label to a Gmail message based on its urgency score.
// Also removes any previously-applied Sentinel labels so only one is active at a time.
async function applyGmailLabel(tokens, gmailMessageId, score, userId) {
  try {
    const { gmail } = buildGmailClient(tokens);
    const labelIds = await ensureLabels(gmail, userId);

    const tier = score >= 7 ? 'URGENT' : score >= 4 ? 'REVIEW' : 'SUPPRESSED';
    const targetLabelId = labelIds[tier];
    if (!targetLabelId) return;

    // Remove the other Sentinel labels so the message has exactly one
    const otherIds = Object.entries(labelIds)
      .filter(([k]) => k !== tier)
      .map(([, v]) => v)
      .filter(Boolean);

    await gmail.users.messages.modify({
      userId: 'me',
      id: gmailMessageId,
      requestBody: {
        addLabelIds: [targetLabelId],
        removeLabelIds: otherIds
      }
    });

    console.log(`[GMAIL] Labelled message ${gmailMessageId} → ${tier} (score ${score})`);
  } catch (e) {
    // Label errors are non-fatal — don't break the ingestion pipeline
    console.warn('[GMAIL] applyGmailLabel error:', e.message);
  }
}

// Star a message (used for critical score ≥ 9 emails)
async function starMessage(tokens, gmailMessageId) {
  try {
    const { gmail } = buildGmailClient(tokens);
    await gmail.users.messages.modify({
      userId: 'me',
      id: gmailMessageId,
      requestBody: { addLabelIds: ['STARRED'] }
    });
    console.log(`[GMAIL] Starred message ${gmailMessageId}`);
  } catch (e) {
    console.warn('[GMAIL] starMessage error:', e.message);
  }
}

// Mark a message as read (called after Sentinel processes it)
async function markAsRead(tokens, gmailMessageId) {
  try {
    const { gmail } = buildGmailClient(tokens);
    await gmail.users.messages.modify({
      userId: 'me',
      id: gmailMessageId,
      requestBody: { removeLabelIds: ['UNREAD'] }
    });
  } catch (e) {
    console.warn('[GMAIL] markAsRead error:', e.message);
  }
}

// ── Auto-reply with threading + deduplication ─────────────────────
// options:
//   subject          – original email subject (for "Re: Subject" line)
//   originalMessageId – original Message-ID header (for In-Reply-To / References)
async function sendReply(tokens, threadId, to, replyText, options = {}) {
  const { gmail } = buildGmailClient(tokens);
  const { subject = '', originalMessageId = '' } = options;

  // Deduplication guard: check if this thread already received a Sentinel auto-reply
  if (await _hasAutoReplied(gmail, threadId)) {
    console.log(`[GMAIL] Skipping duplicate reply to thread ${threadId}`);
    return { skipped: true };
  }

  const subjectLine = subject
    ? (subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`)
    : 'Re: (Sentinel Auto-Reply)';

  const headerLines = [
    `To: ${to}`,
    `Subject: ${subjectLine}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `X-Sentinel-AutoReply: 1`, // dedup marker — checked by _hasAutoReplied
  ];

  if (originalMessageId) {
    headerLines.push(`In-Reply-To: ${originalMessageId}`);
    headerLines.push(`References: ${originalMessageId}`);
  }

  const raw = Buffer.from(headerLines.join('\r\n') + '\r\n\r\n' + replyText)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId }
  });

  console.log(`[GMAIL] Auto-reply sent to thread ${threadId}`);
  return { sent: true };
}

// Check if any message in a thread already has the X-Sentinel-AutoReply header
async function _hasAutoReplied(gmail, threadId) {
  try {
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'metadata',
      metadataHeaders: ['X-Sentinel-AutoReply']
    });
    const messages = thread.data.messages || [];
    return messages.some(m =>
      (m.payload?.headers || []).some(h => h.name === 'X-Sentinel-AutoReply')
    );
  } catch {
    return false; // if we can't check, allow the reply
  }
}

// ── Gmail Pub/Sub watch ───────────────────────────────────────────
// Sets up server-side push notifications so Gmail POSTs to our webhook
// instead of waiting for the next 60s poll.
//
// Prerequisites:
//   1. Cloud Pub/Sub topic created (e.g. projects/MY_PROJECT/topics/sentinel-gmail)
//   2. Push subscription pointing to: POST /integrations/gmail/pubsub?token=VERIFY_TOKEN
//   3. Gmail service account granted Publisher role on the topic:
//      gcloud pubsub topics add-iam-policy-binding sentinel-gmail \
//        --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
//        --role=roles/pubsub.publisher
//
// Watch expires after 7 days — call setupWatch again to renew.
async function setupWatch(tokens, topicName) {
  const { gmail, getRefreshedTokens } = buildGmailClient(tokens);

  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName,
      labelIds: ['INBOX'],
      labelFilterBehavior: 'INCLUDE'
    }
  });

  console.log(`[GMAIL] Watch set up. historyId=${res.data.historyId}, expires=${res.data.expiration}`);
  return {
    historyId:       res.data.historyId,
    expiration:      res.data.expiration,
    refreshedTokens: getRefreshedTokens()
  };
}

// Stop the Gmail push watch for this account
async function stopWatch(tokens) {
  const { gmail } = buildGmailClient(tokens);
  await gmail.users.stop({ userId: 'me' });
  console.log('[GMAIL] Watch stopped');
}

// ── History-based message fetch (used by Pub/Sub webhook) ─────────
// Returns all new INBOX messages added since startHistoryId.
// Call this after receiving a Pub/Sub push notification.
async function getNewMessagesSinceHistory(tokens, startHistoryId) {
  const { gmail, getRefreshedTokens } = buildGmailClient(tokens);
  const messages = [];
  let newHistoryId = null;

  try {
    const histRes = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: String(startHistoryId),
      historyTypes: ['messageAdded'],
      labelId: 'INBOX'
    });

    newHistoryId = histRes.data.historyId || null;
    const history = histRes.data.history || [];

    // Fetch full content for each newly-added message
    for (const record of history) {
      for (const added of (record.messagesAdded || [])) {
        try {
          const full = await gmail.users.messages.get({
            userId: 'me',
            id: added.message.id,
            format: 'full'
          });
          messages.push(parseGmailMessage(full.data));
        } catch (e) {
          console.warn(`[GMAIL] Could not fetch message ${added.message.id}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.warn('[GMAIL] getNewMessagesSinceHistory error:', e.message);
  }

  return {
    messages,
    newHistoryId,
    refreshedTokens: getRefreshedTokens()
  };
}

// ── Email classification helpers (unchanged from original) ─────────
function classifyEmailType(subject, from) {
  const s = subject.toLowerCase();
  const f = from.toLowerCase();
  if (/linkedin\.com/i.test(f)) return classifyLinkedInEmail(subject);
  if (/job|position|opportunity|offer|interview/i.test(s)) return 'job_opportunity';
  if (/invoice|payment|overdue|receipt/i.test(s)) return 'financial';
  if (/alert|warning|critical|urgent|incident/i.test(s)) return 'alert';
  if (/re:|fwd:/i.test(s)) return 'reply';
  return 'email';
}

function classifyLinkedInEmail(subject) {
  const s = subject.toLowerCase();
  if (/message|inmail/i.test(s)) return 'linkedin_message';
  if (/connection/i.test(s)) return 'linkedin_connection';
  if (/job|applied|viewed your profile/i.test(s)) return 'linkedin_job';
  if (/comment|reaction|post/i.test(s)) return 'linkedin_social';
  return 'linkedin_notification';
}

function extractSenderName(from) {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : from.split('@')[0];
}

function extractDomain(from) {
  const match = from.match(/@([^>]+)/);
  return match ? match[1].trim() : from;
}

module.exports = {
  // Auth
  getAuthUrl,
  exchangeCode,
  getEmailAddress,
  // Email fetch & parse
  fetchUnreadEmails,
  parseGmailMessage,
  // Label management
  applyGmailLabel,
  starMessage,
  markAsRead,
  invalidateLabelCache,
  // Auto-reply
  sendReply,
  // Pub/Sub push
  setupWatch,
  stopWatch,
  getNewMessagesSinceHistory
};
