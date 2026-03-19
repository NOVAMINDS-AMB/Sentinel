/**
 * LinkedIn Integration
 *
 * LinkedIn's public API does not expose personal notifications or messages
 * to third-party apps. Sentinel handles LinkedIn in two ways:
 *
 * 1. EMAIL PARSING (primary): LinkedIn sends notification emails to users'
 *    inboxes. When Gmail integration is active, Sentinel automatically
 *    detects and enriches these LinkedIn emails with extra context.
 *
 * 2. LINKEDIN API (supplementary): Used for job alerts and public profile
 *    data where permissions allow.
 *
 * Setup required for LinkedIn API:
 *   1. Go to linkedin.com/developers → Create App
 *   2. Add products: Sign In with LinkedIn, Share on LinkedIn
 *   3. Get Client ID + Secret
 *   4. Add to server/.env: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
 */

// Classify a LinkedIn notification email into a rich type
function classifyLinkedInEmail(subject, body = '') {
  const s = (subject + ' ' + body).toLowerCase();

  if (/sent you a message|inmail/i.test(s)) return { type: 'linkedin_message', baseScore: 7 };
  if (/wants to connect|connection request/i.test(s)) return { type: 'linkedin_connection', baseScore: 4 };
  if (/viewed your profile/i.test(s)) return { type: 'linkedin_profile_view', baseScore: 3 };
  if (/job.*match|recommended.*job|apply.*job|job alert/i.test(s)) return { type: 'linkedin_job_alert', baseScore: 6 };
  if (/interview|schedule|offer|recruiter/i.test(s)) return { type: 'linkedin_recruiter', baseScore: 9 };
  if (/comment|reacted|mentioned you/i.test(s)) return { type: 'linkedin_social', baseScore: 2 };
  if (/endorsed|skill/i.test(s)) return { type: 'linkedin_endorsement', baseScore: 2 };
  if (/anniversary|birthday|new job|promotion/i.test(s)) return { type: 'linkedin_milestone', baseScore: 2 };
  return { type: 'linkedin_notification', baseScore: 3 };
}

// Enrich a Gmail-detected LinkedIn notification with extra metadata
function enrichLinkedInNotification(notification) {
  const { type, baseScore } = classifyLinkedInEmail(notification.title, notification.body);

  return {
    ...notification,
    source: 'linkedin',
    notification_type: type,
    _linkedin_base_score_hint: baseScore,
    // Provide a body hint for Gemini context
    body: `[LinkedIn ${type.replace('linkedin_', '').replace(/_/g, ' ')}] ${notification.title}`
  };
}

// LinkedIn OAuth2 URL builder
function getAuthUrl(userId) {
  if (!process.env.LINKEDIN_CLIENT_ID) {
    throw new Error('LINKEDIN_CLIENT_ID not configured');
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINKEDIN_CLIENT_ID,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3001/integrations/linkedin/callback',
    state: userId,
    scope: 'r_liteprofile r_emailaddress'
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

// Exchange code for access token
async function exchangeCode(code) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.LINKEDIN_CLIENT_ID,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3001/integrations/linkedin/callback'
  });

  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${res.status}`);
  return res.json();
}

module.exports = { classifyLinkedInEmail, enrichLinkedInNotification, getAuthUrl, exchangeCode };
