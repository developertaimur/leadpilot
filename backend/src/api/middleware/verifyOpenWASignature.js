const env = require('../../config/env');
const openwaWebhook = require('../../infrastructure/whatsapp/openwa.webhook');

// Rejects a webhook delivery unless X-OpenWA-Signature matches OPENWA_WEBHOOK_SECRET.
// Fails closed: with no secret configured, every delivery is rejected.
function verifyOpenWASignature(req, res, next) {
  if (!env.openwaWebhookSecret) {
    console.error('Rejected OpenWA webhook: OPENWA_WEBHOOK_SECRET is not set');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  if (!openwaWebhook.verifySignature(req.rawBody, req.get('X-OpenWA-Signature'), env.openwaWebhookSecret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  return next();
}

module.exports = { verifyOpenWASignature };
