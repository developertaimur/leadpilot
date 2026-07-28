const leadRepository = require('../../infrastructure/database/lead.repository');
const conversationRepository = require('../../infrastructure/database/conversation.repository');
const messageRepository = require('../../infrastructure/database/message.repository');
const createLeadUseCase = require('./createLead.useCase');
const createMessageUseCase = require('./createMessage.useCase');
const { normalizePhoneNumber } = require('../../domain/rules/phoneNumber.rules');
const { defaultPhoneRegion } = require('../../config/env');

async function handleIncomingWhatsAppMessage({ phoneNumber, text, name, whatsappMessageId }) {
  const existingMessage = await messageRepository.findMessageByWhatsappId(whatsappMessageId);
  if (existingMessage) {
    return { duplicate: true, messageId: existingMessage.id };
  }

  const normalized = normalizePhoneNumber(phoneNumber, defaultPhoneRegion);
  if (!normalized.valid) {
    throw new Error(`Invalid phone number from webhook: ${normalized.reason}`);
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