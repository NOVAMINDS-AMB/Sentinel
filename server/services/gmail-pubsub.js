/**
 * Gmail Pub/Sub Push Handler
 *
 * Google Cloud Pub/Sub POSTs to /integrations/gmail/pubsub whenever Gmail
 * has a new inbox event for a watched account.
 *
 * Push message format from Google:
 * {
 *   "message": {
 *     "data": "<base64({"emailAddress":"user@example.com","historyId":"123456"})>",
 *     "messageId": "pubsub-id",
 *     "publishTime": "2024-01-01T00:00:00Z"
 *   },
 *   "subscription": "projects/PROJECT/subscriptions/sentinel-gmail-sub"
 * }
 *
 * Setup checklist:
 *   1. Google Cloud Console → Pub/Sub → Create Topic: sentinel-gmail
 *   2. Create Push Subscription:
 *        Endpoint: https://YOUR_SERVER/integrations/gmail/pubsub?token=YOUR_TOKEN
 *        Ack deadline: 20s
 *   3. Grant Gmail's push service account Publisher role:
 *        gcloud pubsub topics add-iam-policy-binding sentinel-gmail \
 *          --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
 *          --role=roles/pubsub.publisher
 *   4. In server/.env:
 *        PUBSUB_TOPIC=projects/YOUR_PROJECT/topics/sentinel-gmail
 *        PUBSUB_VERIFY_TOKEN=a-secret-string-you-choose
 */

/**
 * Decode the base64-encoded data field from a Pub/Sub push message.
 * Returns { emailAddress, historyId } or null if malformed.
 */
function decodePubSubMessage(body) {
  const encoded = body?.message?.data;
  if (!encoded) return null;
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Verify the push endpoint token to prevent spoofed Pub/Sub pushes.
 * Pass PUBSUB_VERIFY_TOKEN as a query param when registering the subscription endpoint:
 *   https://your-server/integrations/gmail/pubsub?token=SECRET
 *
 * Returns true in dev mode (no token configured).
 */
function verifyPubSubToken(queryToken) {
  const expected = process.env.PUBSUB_VERIFY_TOKEN;
  if (!expected) return true;
  return queryToken === expected;
}

module.exports = { decodePubSubMessage, verifyPubSubToken };
