const leadRepository = require('../../infrastructure/database/lead.repository');
const conversationRepository = require('../../infrastructure/database/conversation.repository');

async function createConversation(leadId) {
  const lead = await leadRepository.findLeadById(leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  const existing = await conversationRepository.findConversationByLeadId(leadId);
  if (existing) {
    throw new Error('This lead already has a conversation');
  }

  return conversationRepository.createConversation(leadId);
}

module.exports = { createConversation };