/**
 * WhatsApp Cloud API Integration (Meta)
 *
 * Receives webhook events from Meta's WhatsApp Cloud API and
 * sends replies on the user's behalf via the same API.
 *
 * Setup required:
 *   1. Go to developers.facebook.com → Create App → Business type
 *   2. Add WhatsApp product → Get a test phone number
 *   3. Generate a permanent token (System User in Business Settings)
 *   4. Set webhook URL to: https://your-server/integrations/whatsapp/webhook
 *   5. Subscribe to: messages, message_status
 *   6. Add to server/.env:
 *        WHATSAPP_TOKEN=your_permanent_token
 *        WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
 *        WHATSAPP_VERIFY_TOKEN=any_random_string_you_choose
 */

const https = require('https');
const crypto = require('crypto');

const API_BASE = 'https://graph.facebook.com/v19.0';

// Validate X-Hub-Signature-256 on incoming webhook POST (2.3.5)
function validateSignature(rawBody, signatureHeader) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return true; // skip validation when secret not configured (dev mode)
  if (!signatureHeader) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

// Verify webhook handshake from Meta
function verifyWebhook(query) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return challenge;
  }
  return null;
}

// Parse incoming webhook payload into a normalised notification object
function parseWebhookEvent(body) {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages?.length) return null;

    const msg = value.messages[0];
    const contact = value.contacts?.[0];
    const senderName = contact?.profile?.name || msg.from;
    const phoneId = value.metadata?.phone_number_id;

    let text = '';
    if (msg.type === 'text') text = msg.text?.body || '';
    else if (msg.type === 'image') text = '[Image] ' + (msg.image?.caption || '');
    else if (msg.type === 'document') text = '[Document] ' + (msg.document?.filename || '');
    else if (msg.type === 'audio') text = '[Voice message]';
    else text = `[${msg.type}]`;

    return {
      source: 'whatsapp',
      source_id: `wa-${msg.id}`,
      notification_type: 'whatsapp_message',
      sender_display: senderName,
      sender_domain: msg.from, // phone number as domain
      title: `WhatsApp from ${senderName}`,
      body: text,
      _meta: { phoneId, messageId: msg.id, from: msg.from, waId: msg.from }
    };
  } catch (e) {
    console.error('WhatsApp parse error:', e.message);
    return null;
  }
}

// Send a WhatsApp message
async function sendMessage(to, text) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;

  if (!phoneNumberId || !token) {
    console.warn('WhatsApp credentials not configured — skipping send');
    return;
  }

  const payload = JSON.stringify({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v19.0/${phoneNumberId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data));
        else reject(new Error(`WhatsApp API ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Send the "managed absence" auto-reply
async function sendManagedAbsenceReply(to, senderName, sessionEndTime, urgencyScore) {
  const endTimeStr = sessionEndTime
    ? new Date(sessionEndTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'soon';

  let message;
  if (urgencyScore >= 7) {
    message = `Hi ${senderName}, I'm in a deep work session right now and Sentinel flagged your message as urgent. I'll respond within the next few minutes.`;
  } else {
    message = `Hi ${senderName}, I'm in a focus session until ${endTimeStr}. Sentinel has received your message and I'll get back to you when I'm done. If this is urgent, please reply "URGENT" and I'll be interrupted immediately.`;
  }

  return sendMessage(to, message);
}

module.exports = { verifyWebhook, validateSignature, parseWebhookEvent, sendMessage, sendManagedAbsenceReply };
