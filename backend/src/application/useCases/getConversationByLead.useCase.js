const leadRepository = require('../../infrastructure/database/lead.repository');
const conversationRepository = require('../../infrastructure/database/conversation.repository');

async function getConversationByLead(leadId) {
  const lead = await leadRepository.findLeadById(leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  const conversation = await conversationRepository.findConversationByLeadId(leadId);
  if (!conversation) {
    throw new Error('This lead has no conversation yet');
  }
  return conversation;
}

module.exports = { getConversationByLead };