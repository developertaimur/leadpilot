const leadRepository = require('../../infrastructure/database/lead.repository');
const conversationRepository = require('../../infrastructure/database/conversation.repository');
const messageRepository = require('../../infrastructure/database/message.repository');
const openwaClient = require('../../infrastructure/whatsapp/openwa.client');
const createLeadUseCase = require('./createLead.useCase');
const createMessageUseCase = require('./createMessage.useCase');
const { normalizePhoneNumber } = require('../../domain/rules/phoneNumber.rules');
const { phoneFromChatId } = require('../../domain/rules/whatsappChatId.rules');
const { defaultPhoneRegion } = require('../../config/env');

// Sender phone: straight from a "<digits>@c.us" chat id; for a "<lid>@lid" privacy id, OpenWA's
// senderPhone, else one lookup call. Returns { phone } or { reason } when it stays unknown.
async function resolveSenderPhone(chatId, senderPhone) {
  const fromChatId = phoneFromChatId(chatId);
  if (fromChatId) return { phone: fromChatId };
  if (!chatId.endsWith('@lid')) return { reason: 'Unsupported chat id' };
  if (senderPhone) return { phone: `+${senderPhone.replace(/\D/g, '')}` };
  try {
    const phone = await openwaClient.resolveLidPhone(chatId);
    return phone ? { phone: `+${phone}` } : { reason: 'OpenWA has no phone number for this @lid sender' };
  } catch (err) {
    return { reason: `Phone lookup failed (${err.code ?? err.name})` };
  }
}

async function handleIncomingWhatsAppMessage({ chatId, senderPhone, text, name, whatsappMessageId }) {
  const existingMessage = await messageRepository.findMessageByWhatsappId(whatsappMessageId);
  if (existingMessage) {
    return { duplicate: true, messageId: existingMessage.id };
  }

  const { phone, reason } = await resolveSenderPhone(chatId, senderPhone);
  if (!phone) {
    return { skipped: true, reason };
  }

  const normalized = normalizePhoneNumber(phone, defaultPhoneRegion);
  if (!normalized.valid) {
    return { skipped: true, reason: `Invalid phone number: ${normalized.reason}` };
  }

  let lead = await leadRepository.findLeadByPhone(normalized.e164);
  if (!lead) {
    lead = await createLeadUseCase.createLead({
      name,
      phoneNumber: normalized.e164,
      source: 'whatsapp_inbound',
      campaignId: null,
    });
  }

  let conversation = await conversationRepository.findConversationByLeadId(lead.id);
  if (!conversation) {
    conversation = await conversationRepository.createConversation(lead.id);
  }

  const message = await createMessageUseCase.createMessage(conversation.id, {
    sender: 'LEAD',
    content: text,
    whatsappMessageId,
  });

  return { duplicate: false, leadId: lead.id, conversationId: conversation.id, messageId: message.id };
}

module.exports = { handleIncomingWhatsAppMessage };
