const handleIncomingWhatsAppMessageUseCase = require('../../application/useCases/handleIncomingWhatsAppMessage.useCase');
const getWhatsAppStatusUseCase = require('../../application/useCases/getWhatsAppStatus.useCase');
const openwaWebhook = require('../../infrastructure/whatsapp/openwa.webhook');
const autoReply = require('../../application/ai/autoReply');

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

  let result;
  try {
    result = await handleIncomingWhatsAppMessageUseCase.handleIncomingWhatsAppMessage(parsed);
    if (result.skipped) {
      console.warn(`Skipped WhatsApp message ${logId}: ${result.reason}`);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error(`Failed to save WhatsApp message ${logId} (${err.code ?? err.name})`);
    return res.status(500).json({ error: 'Failed to process message' });
  }

  // Only after the 200 has been sent, and only for a message saved just now (not a duplicate or a skip):
  // the AI reply runs in the background, so OpenWA never waits for it or sees its errors.
  if (!result.skipped && result.duplicate === false) {
    autoReply.scheduleReply(result.conversationId, result.messageId);
  }
}

// 502 for any OpenWA answer other than a usable status; details stay in the log as a code only.
async function getStatus(req, res) {
  try {
    res.json(await getWhatsAppStatusUseCase.getWhatsAppStatus());
  } catch (err) {
    console.error(`WhatsApp status check failed (${err.code ?? err.status ?? err.name})`);
    res.status(502).json({ error: 'OpenWA error' });
  }
}

module.exports = { receiveWebhook, getStatus };
