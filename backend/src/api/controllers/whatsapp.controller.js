const handleIncomingWhatsAppMessageUseCase = require('../../application/useCases/handleIncomingWhatsAppMessage.useCase');
const openwaWebhook = require('../../infrastructure/whatsapp/openwa.webhook');

// Runs after verifyOpenWASignature. Answers 200 only once the message is saved or deliberately
// ignored, so OpenWA retries when saving fails. Logs never include message text, names or phone numbers.
async function receiveWebhook(req, res) {
  let parsed;
  try {
    parsed = openwaWebhook.parseIncoming(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!parsed) return res.sendStatus(200);

  const logId = openwaWebhook.logSafeId(parsed.whatsappMessageId);
  if (parsed.ignored) {
    console.info(`Ignored WhatsApp message ${logId}: ${parsed.ignored}, kind=${parsed.kind} type=${parsed.type}`);
    return res.sendStatus(200);
  }

  try {
    const result = await handleIncomingWhatsAppMessageUseCase.handleIncomingWhatsAppMessage(parsed);
    if (result.skipped) {
      console.warn(`Skipped WhatsApp message ${logId}: ${result.reason}`);
    }
    return res.sendStatus(200);
  } catch (err) {
    console.error(`Failed to save WhatsApp message ${logId} (${err.code ?? err.name})`);
    return res.status(500).json({ error: 'Failed to process message' });
  }
}

module.exports = { receiveWebhook };
