/**
 * Sentinel Test Email Sender
 *
 * Sends realistic test emails to your Gmail inbox every 60 seconds
 * so you can see Sentinel score, label, and route them in real time.
 *
 * Usage:
 *   node test-email-sender.js [--user-id <uuid>] [--to <email>] [--interval <seconds>] [--count <n>]
 *
 * Defaults:
 *   --interval  60   (seconds between batches)
 *   --count     30   (total emails to send, then stop)
 *   --to        uses the Gmail address from Supabase for the given user
 *
 * Prereqs:
 *   npm install @supabase/supabase-js googleapis dotenv commander
 *   (these are already in server/package.json)
 */

require('dotenv').config();
const { createClient }  = require('@supabase/supabase-js');
const { google }        = require('googleapis');

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLIENT_ID     = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI  = process.env.GMAIL_REDIRECT_URI;

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const TARGET_USER_ID  = getArg('--user-id',  null);
const TARGET_EMAIL    = getArg('--to',        null);
const INTERVAL_SEC    = parseInt(getArg('--interval', '60'), 10);
const TOTAL_COUNT     = parseInt(getArg('--count',    '30'), 10);

// ── Email pool (varied urgency tiers) ────────────────────────────────────────

const EMAIL_POOL = [
  // CRITICAL (score 9-10)
  {
    tier: 'CRITICAL',
    subject: '🚨 URGENT: Production database is DOWN',
    body: `Hi,

Our production database is completely unresponsive. All services are returning 503 errors.
Users cannot log in. Revenue impact is ~$5,000/minute.

Please respond IMMEDIATELY.

— Ops Team`
  },
  {
    tier: 'CRITICAL',
    subject: 'Security breach detected on prod server',
    body: `URGENT SECURITY ALERT

We've detected unauthorized access on your production server at 03:47 UTC.
Suspicious outbound connections to 185.220.x.x (known Tor exit node).

Action required: Rotate all credentials and review access logs NOW.

— Security Monitoring`
  },
  {
    tier: 'CRITICAL',
    subject: 'Interview scheduled: Senior Engineer role at Stripe',
    body: `Hi,

We'd love to schedule a technical interview for the Senior Software Engineer role.
We have a slot available tomorrow at 2:00 PM EST — can you confirm?

This is time-sensitive as we're moving fast with our hiring process.

— Stripe Recruiting`
  },

  // HIGH (score 7-8)
  {
    tier: 'HIGH',
    subject: 'CI/CD Pipeline FAILED on main branch',
    body: `Build #2847 failed on main.

Failed step: Integration tests (12 tests failed)
Commit: a3f92bc — "Refactor auth middleware"
Author: dev@team.com

This is blocking the release scheduled for today.
View logs: https://ci.example.com/builds/2847

— GitHub Actions`
  },
  {
    tier: 'HIGH',
    subject: 'Re: Can you review this PR before the deadline?',
    body: `Hey,

I know you're heads-down but this PR is blocking the team from merging the feature branch.
Client demo is in 2 hours and we need your sign-off.

PR: https://github.com/org/repo/pull/423

Thanks so much,
— Alex`
  },
  {
    tier: 'HIGH',
    subject: 'Blocking question on the API integration',
    body: `Hi,

We're stuck on the OAuth token refresh flow and can't proceed without input from you.
The integration is due to the client today.

Can you jump on a quick call or reply with guidance?

— Backend Team`
  },
  {
    tier: 'HIGH',
    subject: 'Job offer received — need response by EOD',
    body: `Congratulations!

We're pleased to extend an offer for the Principal Engineer position.
Compensation: $180,000 base + equity.

Please respond by 5:00 PM today to secure this offer.

— TechCorp HR`
  },

  // MEDIUM (score 5-6)
  {
    tier: 'MEDIUM',
    subject: 'PR Review requested: Add dark mode support',
    body: `Hey,

When you get a chance, could you take a look at my PR?
No rush — it's not blocking anything critical.

PR: https://github.com/org/repo/pull/389

— Jamie`
  },
  {
    tier: 'MEDIUM',
    subject: 'Team standup notes — March 19',
    body: `Hi team,

Here are today's standup notes:

✅ Alice: Finished auth refactor, starting on billing
✅ Bob: Deployed hotfix to staging
🚧 Carol: Blocked on design review
📋 Dave: Writing docs for v2 API

— Scrum Bot`
  },
  {
    tier: 'MEDIUM',
    subject: 'New comment on your PR #389',
    body: `@you left a comment on PR #389:

"Looks good overall! Just a few nits:
1. Line 47: variable name could be clearer
2. Missing error handling in the catch block
3. Can we add a test for the edge case?"

— GitHub`
  },
  {
    tier: 'MEDIUM',
    subject: 'Re: Project timeline update',
    body: `Hi,

Following up on our conversation from Monday. Can we sync this week about the revised
timeline? The client has moved the deadline to April 1st.

Let me know your availability.

— Project Manager`
  },
  {
    tier: 'MEDIUM',
    subject: 'LinkedIn: New connection request from Sarah Chen',
    body: `Hi,

Sarah Chen, Engineering Manager at DataFlow Inc., wants to connect with you on LinkedIn.

Sarah's note: "I came across your work on distributed systems — would love to connect!"

— LinkedIn`
  },

  // LOW (score 2-4)
  {
    tier: 'LOW',
    subject: 'Weekly digest: Top articles in Software Engineering',
    body: `Your weekly reading list is ready!

• "10 Things I Wish I Knew About Kubernetes"
• "The Future of WebAssembly"
• "Why Rust Is Taking Over Systems Programming"
• "Building Resilient Microservices"

Read now → https://digest.example.com/weekly/2847

— The Engineering Digest`
  },
  {
    tier: 'LOW',
    subject: 'FYI: Updated the shared design system docs',
    body: `Hey team,

Just a heads up — I've updated the design system documentation with the new color tokens
and spacing guidelines. Check it out when you get a chance.

No action needed from you.

— Design Team`
  },
  {
    tier: 'LOW',
    subject: 'Your GitHub contribution graph looks great this month!',
    body: `Hi,

You've made 47 commits this month — you're on a streak!

Keep up the great work. Here's a look at your stats:
• 47 commits
• 8 pull requests merged
• 23 issues closed

— GitHub`
  },
  {
    tier: 'LOW',
    subject: 'Status update: Deployment to staging successful',
    body: `Automated notification: Deployment #2846 to staging completed successfully.

Version: v2.3.1
Environment: staging
Duration: 2m 34s
Status: ✅ PASSED

No action required.

— Deploy Bot`
  },
  {
    tier: 'LOW',
    subject: 'Re: Lunch plans on Friday?',
    body: `Hey! Are you free for lunch on Friday? A few of us are thinking of trying that new
ramen place around the corner.

Let us know!
— Mike`
  },

  // NOISE (score 0-1)
  {
    tier: 'NOISE',
    subject: '🎉 Your Notion workspace hit 1,000 pages!',
    body: `Congratulations! Your Notion workspace "Work Projects" just hit 1,000 pages.

You're among the top 5% of Notion users by content volume. Keep building!

🚀 Level up with Notion AI — now included in your plan.

— Notion Team`
  },
  {
    tier: 'NOISE',
    subject: 'New follower on Twitter/X',
    body: `techbro_42 is now following you on X.

Their latest post: "Just shipped another side project 🚀 #buildinpublic"

— X (formerly Twitter)`
  },
  {
    tier: 'NOISE',
    subject: 'Invoice #INV-2024-0392 has been paid ✓',
    body: `Your invoice has been paid automatically.

Amount: $29.00
Plan: Pro Monthly
Next billing date: April 19, 2026

Thank you for using our service!

— Billing System`
  },
  {
    tier: 'NOISE',
    subject: 'Introducing AI-powered analytics (Product update)',
    body: `Exciting news from the team!

We've shipped AI-powered analytics to all Pro users. Here's what's new:
• Smart trend detection
• Automated report generation
• Natural language queries

Log in to try it → app.example.com

— Product Team`
  },
  {
    tier: 'NOISE',
    subject: 'Your subscription renews in 7 days',
    body: `Just a friendly reminder that your subscription renews on March 26, 2026.

Plan: Developer Pro
Amount: $49/month
Payment method: •••• 4242

To manage your subscription, visit your account settings.

— Billing`
  },
  {
    tier: 'NOISE',
    subject: '👍 Alex reacted to your comment',
    body: `Alex liked your comment in #engineering:

"The new caching layer is looking great — really improved response times!"

— Slack`
  },
  // More HIGH/CRITICAL for good mix
  {
    tier: 'CRITICAL',
    subject: 'ALERT: Memory usage at 98% on prod-server-01',
    body: `CRITICAL SYSTEM ALERT

Server: prod-server-01
Metric: Memory usage
Current: 98.4% (15.7 GB / 16 GB)
Threshold: 90%

Automatic actions failed. Manual intervention required immediately.

— Infrastructure Monitor`
  },
  {
    tier: 'HIGH',
    subject: 'Your manager wants to talk — urgent',
    body: `Hi,

Your manager, [Manager Name], flagged this as urgent and wants to connect with you
before the all-hands at 3PM today.

Can you ping them on Slack ASAP?

— Calendar Assistant`
  },
  {
    tier: 'MEDIUM',
    subject: 'Reminder: Performance review self-assessment due Friday',
    body: `Hi,

This is a reminder that your Q1 performance review self-assessment is due this Friday,
March 21st.

Complete it here: hr.example.com/review/2026-q1

— HR System`
  },
  {
    tier: 'LOW',
    subject: 'Tech Talk: "Scaling to 1M users" — Recording available',
    body: `The recording for last week's Tech Talk is now available.

"Scaling to 1M users: Lessons learned the hard way"
Speaker: Jane Doe, Principal Engineer @ BigCo

Watch now → talks.example.com/recordings/2847

— Tech Talks Team`
  },
  {
    tier: 'NOISE',
    subject: 'Rate your experience with our support team',
    body: `How did we do?

Your recent support ticket #48392 has been resolved. We'd love your feedback!

⭐⭐⭐⭐⭐

Rate your experience → support.example.com/rate/48392

— Support Team`
  },
  {
    tier: 'CRITICAL',
    subject: 'Payment failed — action required within 24 hours',
    body: `URGENT: Your payment of $2,499.00 for the Enterprise subscription has FAILED.

Card ending in 4242 was declined.

If not resolved within 24 hours, your account will be suspended and team access revoked.

Update payment → billing.example.com/update

— Billing Team`
  },
  {
    tier: 'HIGH',
    subject: 'Merge conflict blocking release — need your fix',
    body: `Hi,

The release branch has a merge conflict in auth/middleware.js that only you can resolve
(you were the last to touch the file).

Release is scheduled for 4 PM — can you fix this ASAP?

— Release Manager`
  },
];

// ── Gmail OAuth helper ────────────────────────────────────────────────────────

function makeOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

async function getTokensForUser(supabase, userId) {
  let query = supabase
    .from('user_integrations')
    .select('credentials, status')
    .eq('integration_type', 'email');

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query.limit(1).single();
  if (error || !data) throw new Error(`No connected Gmail account found${userId ? ` for user ${userId}` : ''}. Connect Gmail first.`);
  if (!data.credentials?.tokens) throw new Error('Gmail row found but tokens are missing. Reconnect Gmail.');
  return data.credentials.tokens;
}

async function sendTestEmail(tokens, to, subject, body) {
  const auth = makeOAuth2Client();
  auth.setCredentials({
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date:   tokens.expiry_date,
  });

  const gmail = google.gmail({ version: 'v1', auth });

  const timestamp = new Date().toLocaleTimeString();
  const fullBody = `${body}\n\n---\n[Sentinel Test Email | ${timestamp}]`;

  const message = [
    `From: "Sentinel Test" <${to}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    fullBody,
  ].join('\r\n');

  const encoded = Buffer.from(message).toString('base64url');
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
}

async function getGmailAddress(tokens) {
  const auth = makeOAuth2Client();
  auth.setCredentials({
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date:   tokens.expiry_date,
  });
  const gmail = google.gmail({ version: 'v1', auth });
  const { data } = await gmail.users.getProfile({ userId: 'me' });
  return data.emailAddress;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 Sentinel Test Email Sender');
  console.log('================================');
  console.log(`Total emails : ${TOTAL_COUNT}`);
  console.log(`Interval     : ${INTERVAL_SEC}s`);
  console.log(`User ID      : ${TARGET_USER_ID || '(first connected Gmail user)'}`);
  console.log('');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
    process.exit(1);
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('❌ Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log('🔍 Looking up Gmail credentials from Supabase...');
  const tokens = await getTokensForUser(supabase, TARGET_USER_ID);
  console.log('✅ Gmail credentials loaded');

  const toEmail = TARGET_EMAIL || await getGmailAddress(tokens);
  console.log(`📧 Sending to: ${toEmail}`);
  console.log('');

  // Shuffle pool so we get a nice mix each run
  const shuffled = [...EMAIL_POOL].sort(() => Math.random() - 0.5);
  let sent = 0;

  const sendNext = async () => {
    if (sent >= TOTAL_COUNT) {
      console.log(`\n✅ Done! Sent ${sent} emails. Sentinel should have processed them all.`);
      process.exit(0);
    }

    const email = shuffled[sent % shuffled.length];
    sent++;

    try {
      await sendTestEmail(tokens, toEmail, email.subject, email.body, email.tier);
      const now = new Date().toLocaleTimeString();
      console.log(`[${now}] ✉  #${String(sent).padStart(2, '0')}/${TOTAL_COUNT} [${email.tier.padEnd(8)}] ${email.subject.slice(0, 55)}`);
    } catch (err) {
      console.error(`[ERROR] Failed to send email #${sent}: ${err.message}`);
    }

    if (sent < TOTAL_COUNT) {
      setTimeout(sendNext, INTERVAL_SEC * 1000);
    } else {
      console.log(`\n✅ Done! Sent ${sent} emails. Sentinel should have processed them all.`);
      process.exit(0);
    }
  };

  console.log(`⏳ Starting in 2 seconds...\n`);
  setTimeout(sendNext, 2000);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
