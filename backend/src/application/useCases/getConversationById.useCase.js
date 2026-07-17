const conversationRepository = require('../../infrastructure/database/conversation.repository');

async function getConversationById(id) {
  const conversation = await conversationRepository.findConversationById(id);
  if (!conversation) {
    throw new Error('Conversation not found');
  }
  return conversation;
}

module.exports = { getConversationById };