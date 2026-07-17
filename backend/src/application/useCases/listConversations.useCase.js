const conversationRepository = require('../../infrastructure/database/conversation.repository');

async function listConversations() {
  return conversationRepository.findAllConversations();
}

module.exports = { listConversations };