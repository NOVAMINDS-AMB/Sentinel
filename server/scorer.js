const Groq = require('groq-sdk');
const { extractFeatures, applyPersonalization, buildUserContext, loadProfile } = require('./ml');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const withTimeout = (promise, ms) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Groq timeout after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
};

// Retry once on 429 with a short backoff (3.1.9)
async function withRetry(fn, retries = 1, delayMs = 2000) {
  try {
    return await fn();
  } catch (err) {
    const is429 = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('rate_limit');
    if (retries > 0 && is429) {
      await new Promise(r => setTimeout(r, delayMs));
      return withRetry(fn, retries - 1, delayMs * 2);
    }
    throw err;
  }
}

const BASE_PROMPT = `You are an urgency scorer for Sentinel, a focus management system.
A notification arrived while the user is in a deep work session.
Score urgency 0–10:

9-10 CRITICAL (interrupt now): production down, security breach, job interview scheduled, urgent from manager/CTO
7-8  HIGH (interrupt):         CI failure on main, blocking PR, time-sensitive direct question, recruiter with offer
5-6  MEDIUM (queue):           regular PR reviews, non-urgent DMs, team threads, job alerts
2-4  LOW (batch at end):       FYI mentions, status updates, newsletter, non-blocking comments
0-1  NOISE (auto-dismiss):     bots, automated reports, social reactions, marketing

Return ONLY valid JSON with no markdown: {"score": <0-10>, "reason": "<one sentence>", "tier": "<critical|high|medium|low|noise>"}`;

async function scoreNotification(notification, userId = null, supabase = null) {
  let profile = null;
  let onboarding = null;

  if (userId && supabase) {
    try {
      const data = await loadProfile(userId, supabase);
      profile = data.profile;
      onboarding = data.onboarding;
    } catch (e) { /* non-fatal */ }
  }

  const userContext = buildUserContext(profile, onboarding);

  try {
    const response = await withRetry(() => withTimeout(groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: BASE_PROMPT + userContext },
        { role: 'user', content:
          `Notification:\n- Source: ${notification.source}\n- Type: ${notification.notification_type}\n- Sender: ${notification.sender_display}\n- Title: ${notification.title}\n- Body: ${(notification.body || '').slice(0, 300)}`
        }
      ],
      temperature: 0.1,
      max_tokens: 100,
    }), 5000));

    const text = response.choices[0]?.message?.content?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);
    const baseScore = Math.min(10, Math.max(0, Number(parsed.score)));
    // Extract features once and reuse — fixes bug where raw notification was
    // passed to applyPersonalization instead of the expected features object.
    const features = extractFeatures(notification);
    const finalScore = applyPersonalization(baseScore, features, profile);

    return {
      score: finalScore,
      baseScore,
      reason: parsed.reason || '',
      tier: parsed.tier || tierFromScore(finalScore),
      source: 'groq'
    };
  } catch (err) {
    console.warn('Groq scoring fallback:', err.message);
    const fallback = fallbackScore(notification, profile);
    const features = extractFeatures(notification);
    const finalScore = applyPersonalization(fallback.score, features, profile);
    return { ...fallback, score: finalScore, source: 'fallback' };
  }
}

function fallbackScore(notification, profile) {
  const text = `${notification.title} ${notification.body || ''}`.toLowerCase();
  const urgentWords = ['urgent', 'critical', 'down', 'broken', 'failed', 'asap', 'emergency', 'blocked', 'interview', 'offer'];
  const hasUrgent = urgentWords.some(w => text.includes(w));

  const sender = (notification.sender_display || '').toLowerCase();
  if (profile?.vip_senders?.some(v => sender.includes(v.toLowerCase()))) return { score: 9, reason: 'VIP sender', tier: 'critical' };
  if (profile?.blocked_senders?.some(b => sender.includes(b.toLowerCase()))) return { score: 1, reason: 'Blocked sender', tier: 'noise' };
  if (notification.source === 'github' && /fail|error/.test(text)) return { score: 8, reason: 'CI/CD failure', tier: 'high' };
  if (notification.source === 'linkedin' && /interview|recruiter|offer/.test(text)) return { score: 9, reason: 'LinkedIn career opportunity', tier: 'critical' };
  if (hasUrgent) return { score: 7, reason: 'Urgent keywords detected', tier: 'high' };
  if (/direct|dm|message/.test(notification.notification_type)) return { score: 5, reason: 'Direct message', tier: 'medium' };
  if (notification.source === 'linkedin') return { score: 3, reason: 'LinkedIn notification', tier: 'low' };
  return { score: 3, reason: 'Standard notification', tier: 'low' };
}

function tierFromScore(score) {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 5) return 'medium';
  if (score >= 2) return 'low';
  return 'noise';
}

async function generateDraft(notificationTitle, senderDomain, excerpt) {
  try {
    const response = await withRetry(() => withTimeout(groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a professional assistant drafting brief, polite reply messages for someone who was in a deep focus session. Write exactly 1-2 sentences. Sound human and warm, not robotic. Do not start with "I". No subject lines. No placeholders.'
        },
        {
          role: 'user',
          content: `Draft a reply for a message from ${senderDomain || 'a contact'} about "${notificationTitle}".${excerpt ? ` Message: "${excerpt.slice(0, 150)}"` : ''} Let them know I was focused and will follow up shortly.`
        }
      ],
      temperature: 0.7,
      max_tokens: 80
    }), 5000));
    return response.choices[0]?.message?.content?.trim() || null;
  } catch (e) {
    return null;
  }
}

module.exports = { scoreNotification, generateDraft };
