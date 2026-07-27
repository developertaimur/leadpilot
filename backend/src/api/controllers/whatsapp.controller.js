const { whatsappWebhookVerifyToken } = require('../../config/env');
const { parseIncomingMessage } = require('../../infrastructure/whatsapp/whatsapp.parser');
const { handleIncomingWhatsAppMessage } = require('../../application/useCases/handleIncomingWhatsAppMessage.useCase');

function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === whatsappWebhookVerifyToken) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
}

async function receiveWebhook(req, res) {
  res.sendStatus(200);

  try {
    const parsed = parseIncomingMessage(req.body);
    if (parsed) {
      await handleIncomingWhatsAppMessage(parsed);
    }
  } catch (err) {
    console.error('Error handling incoming WhatsApp message:', err.message);
  }
}

module.exports = { verifyWebhook, receiveWebhook };