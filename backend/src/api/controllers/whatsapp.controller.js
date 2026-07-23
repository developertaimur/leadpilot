const { whatsappWebhookVerifyToken } = require('../../config/env');

function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === whatsappWebhookVerifyToken) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
}

module.exports = { verifyWebhook };