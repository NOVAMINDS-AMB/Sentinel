/**
 * Sentinel ML Engine
 *
 * Implements a personalised urgency scoring system using online learning.
 * The base Groq score is adjusted by per-user weights that update after
 * every piece of user feedback (correct / too_high / too_low / vip / block).
 *
 * Learning phases:
 *   Phase 1 (0–15 interactions)  — cold start, uses onboarding defaults only
 *   Phase 2 (15–50 interactions) — weights diverge, Gemini gets user context
 *   Phase 3 (50+ interactions)   — fully personalised, weekly pattern hints injected
 */

const LEARNING_RATE = 0.15;
const MAX_WEIGHT = 3.0;
const MIN_WEIGHT = 0.1;

const URGENT_KEYWORDS = [
  'urgent', 'critical', 'asap', 'emergency', 'blocked', 'down', 'failed',
  'interview', 'offer', 'deadline', 'breach', 'incident', 'production',
  'client', 'cto', 'ceo', 'boss', 'hire', 'fired', 'lawsuit', 'payment'
];

// ── Sender normalisation: strip display name, keep email/domain ───
function normalizeSender(raw) {
  if (!raw) return '';
  // "Display Name <email@domain.com>" → "email@domain.com"
  const emailMatch = raw.match(/<([^>]+)>/);
  if (emailMatch) return emailMatch[1].toLowerCase().trim();
  // Bare email address
  if (raw.includes('@')) return raw.toLowerCase().trim();
  // Domain or opaque identifier — return as-is
  return raw.toLowerCase().trim();
}

// ── Feature extraction ────────────────────────────────────────────
function extractFeatures(notification) {
  const text = `${notification.title || ''} ${notification.body || ''}`.toLowerCase();
  const hour = new Date().getHours();

  const detectedKeywords = URGENT_KEYWORDS.filter(kw => text.includes(kw));
  // Also extract notable words from the message itself (top nouns/verbs heuristic)
  const customKeywords = text.match(/\b[a-z]{4,}\b/g)?.filter(w =>
    !['this', 'that', 'with', 'from', 'have', 'will', 'your', 'they', 'been', 'were'].includes(w)
  ).slice(0, 5) || [];

  return {
    sender: normalizeSender(notification.sender_display || notification.sender_domain || ''),
    source: notification.source || 'unknown',
    keywords: [...new Set([...detectedKeywords, ...customKeywords])],
    timeOfDay: hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening',
    isDirectMessage: /direct|dm|message|pm/i.test(notification.notification_type || ''),
    bodyLength: (notification.body || '').length,
    hasQuestion: text.includes('?'),
  };
}

// ── Apply profile weights to base Groq score ─────────────────────
function applyPersonalization(baseScore, features, profile) {
  if (!profile || profile.total_interactions < 5) return baseScore;

  // VIP sender — always surfaces
  if (profile.vip_senders?.some(v => features.sender.includes(v.toLowerCase()))) {
    return Math.min(10, Math.max(baseScore, 8));
  }

  // Blocked sender — always suppressed
  if (profile.blocked_senders?.some(b => features.sender.includes(b.toLowerCase()))) {
    return Math.min(2, baseScore);
  }

  let multiplier = 1.0;

  // Sender weight
  const senderKey = features.sender;
  if (profile.sender_weights?.[senderKey]) {
    multiplier *= profile.sender_weights[senderKey];
  }

  // Source weight
  const sourceWeight = profile.source_weights?.[features.source] ?? 1.0;
  multiplier *= sourceWeight;

  // Time weight
  const timeWeight = profile.time_weights?.[features.timeOfDay] ?? 1.0;
  multiplier *= timeWeight;

  // Keyword weights (average of matched keywords)
  const kwWeights = features.keywords
    .map(kw => profile.keyword_weights?.[kw] ?? 1.0);
  if (kwWeights.length > 0) {
    const avgKw = kwWeights.reduce((a, b) => a + b, 0) / kwWeights.length;
    multiplier *= avgKw;
  }

  // Focus keyword boost
  if (profile.focus_keywords?.some(fk => features.keywords.includes(fk.toLowerCase()))) {
    multiplier *= 1.4;
  }

  const adjusted = baseScore * multiplier;
  return Math.min(10, Math.max(0, Math.round(adjusted * 10) / 10));
}

// ── Build Groq context string from profile ────────────────────────
function buildUserContext(profile, onboarding) {
  if (!profile && !onboarding) return '';

  const interactions = profile?.total_interactions || 0;
  const accuracy = interactions > 0
    ? Math.round((profile.correct_predictions / interactions) * 100)
    : null;

  const parts = [];

  if (onboarding?.role) parts.push(`User role: ${onboarding.role}`);
  if (onboarding?.vip_senders?.length) parts.push(`VIP senders (always urgent): ${onboarding.vip_senders.join(', ')}`);
  if (onboarding?.focus_keywords?.length) parts.push(`User's priority keywords: ${onboarding.focus_keywords.join(', ')}`);

  if (interactions >= 15) {
    const topSenders = Object.entries(profile.sender_weights || {})
      .sort(([, a], [, b]) => b - a).slice(0, 3).map(([s, w]) => `${s} (weight: ${w.toFixed(2)})`);
    if (topSenders.length) parts.push(`High-priority senders learned: ${topSenders.join(', ')}`);

    const topKeywords = Object.entries(profile.keyword_weights || {})
      .sort(([, a], [, b]) => b - a).slice(0, 5).map(([k, w]) => `${k} (${w.toFixed(2)})`);
    if (topKeywords.length) parts.push(`High-weight keywords learned: ${topKeywords.join(', ')}`);
  }

  if (accuracy !== null) parts.push(`Model accuracy so far: ${accuracy}% (${interactions} interactions)`);

  return parts.length ? `\n\nUser profile context:\n${parts.map(p => `- ${p}`).join('\n')}` : '';
}

// ── Load profile from Supabase ────────────────────────────────────
async function loadProfile(userId, supabase) {
  const [{ data: profile }, { data: onboarding }] = await Promise.all([
    supabase.from('user_ml_profile').select('*').eq('user_id', userId).single(),
    supabase.from('user_onboarding').select('*').eq('user_id', userId).single()
  ]);
  return { profile: profile || null, onboarding: onboarding || null };
}

// ── Update profile after feedback ─────────────────────────────────
async function updateFromFeedback(userId, notification, rating, responseTimeSecs, supabase) {
  const { profile, onboarding } = await loadProfile(userId, supabase);
  const features = extractFeatures(notification);

  const current = profile || {
    user_id: userId,
    role: onboarding?.role || 'professional',
    sender_weights: {},
    keyword_weights: {},
    source_weights: { email: 1.0, whatsapp: 1.0, linkedin: 1.0 },
    time_weights: { morning: 1.0, afternoon: 1.0, evening: 1.0 },
    vip_senders: onboarding?.vip_senders || [],
    blocked_senders: [],
    focus_keywords: onboarding?.focus_keywords || [],
    total_interactions: 0,
    correct_predictions: 0
  };

  // Determine learning signal
  let signal = 0;
  if (rating === 'too_high') signal = -1.0;
  else if (rating === 'too_low') signal = 1.0;
  else if (rating === 'correct') {
    signal = 0;
    current.correct_predictions = (current.correct_predictions || 0) + 1;
  } else if (rating === 'vip_add') {
    if (!current.vip_senders.includes(features.sender)) {
      current.vip_senders = [...current.vip_senders, features.sender];
    }
  } else if (rating === 'block_sender') {
    if (!current.blocked_senders.includes(features.sender)) {
      current.blocked_senders = [...current.blocked_senders, features.sender];
    }
  }

  // Also infer from response time: < 20s response = user found it important
  if (responseTimeSecs !== undefined && responseTimeSecs < 20 && signal === 0) {
    signal = 0.5; // mild positive signal
  }

  if (signal !== 0) {
    // Update sender weight
    const sw = current.sender_weights[features.sender] ?? 1.0;
    current.sender_weights[features.sender] = clamp(sw + signal * LEARNING_RATE);

    // Update source weight
    const srcw = current.source_weights[features.source] ?? 1.0;
    current.source_weights[features.source] = clamp(srcw + signal * LEARNING_RATE * 0.3, 0.3, 2.0);

    // Update time weight
    const tw = current.time_weights[features.timeOfDay] ?? 1.0;
    current.time_weights[features.timeOfDay] = clamp(tw + signal * LEARNING_RATE * 0.2, 0.5, 1.8);

    // Update keyword weights
    features.keywords.forEach(kw => {
      const kw_w = current.keyword_weights[kw] ?? 1.0;
      current.keyword_weights[kw] = clamp(kw_w + signal * LEARNING_RATE * 0.5);
    });
  }

  current.total_interactions = (current.total_interactions || 0) + 1;
  current.updated_at = new Date().toISOString();

  // Upsert
  await supabase.from('user_ml_profile').upsert({
    ...current,
    user_id: userId
  }, { onConflict: 'user_id' });

  // Log feedback record
  await supabase.from('notification_feedback').insert({
    user_id: userId,
    notification_id: notification.id || null,
    ai_score: notification.final_score || 0,
    final_score: notification.final_score || 0,
    rating,
    sender: features.sender,
    source: features.source,
    keywords: features.keywords,
    response_time_seconds: responseTimeSecs || null
  });

  return current;
}

// ── Generate AI self-optimisation suggestions ─────────────────────
function generateOptimisationSuggestions(profile, recentNotifications) {
  const suggestions = [];
  if (!profile || profile.total_interactions < 20) {
    return ['Keep using Sentinel — personalised suggestions appear after 20+ interactions.'];
  }

  // Find highest-volume sources
  const sourceCounts = {};
  recentNotifications.forEach(n => {
    sourceCounts[n.source] = (sourceCounts[n.source] || 0) + 1;
  });
  const topSource = Object.entries(sourceCounts).sort(([,a],[,b]) => b-a)[0];
  if (topSource) suggestions.push(`${topSource[0]} is your top interrupt source (${topSource[1]} notifications) — consider reviewing notification settings there.`);

  // Find low-weight senders taking up space
  const lowSenders = Object.entries(profile.sender_weights || {})
    .filter(([, w]) => w < 0.5).map(([s]) => s);
  if (lowSenders.length > 3) suggestions.push(`${lowSenders.length} senders consistently score low for you — consider blocking them in Sentinel to reduce noise.`);

  // Accuracy feedback
  const accuracy = Math.round((profile.correct_predictions / profile.total_interactions) * 100);
  if (accuracy < 60) suggestions.push(`Sentinel's accuracy is ${accuracy}% — keep giving feedback with the correct/wrong buttons to improve faster.`);
  else if (accuracy > 85) suggestions.push(`Sentinel is ${accuracy}% accurate for you — your profile is well calibrated.`);

  // Time pattern
  const timeWeights = profile.time_weights || {};
  const lowestTime = Object.entries(timeWeights).sort(([,a],[,b]) => a-b)[0];
  if (lowestTime && lowestTime[1] < 0.7) suggestions.push(`You receive fewer important messages in the ${lowestTime[0]} — that might be your best deep work window.`);

  return suggestions.length ? suggestions : ['Your notification patterns look well-balanced. No optimisations needed right now.'];
}

function clamp(val, min = MIN_WEIGHT, max = MAX_WEIGHT) {
  return Math.min(max, Math.max(min, val));
}

module.exports = { extractFeatures, applyPersonalization, buildUserContext, loadProfile, updateFromFeedback, generateOptimisationSuggestions };
