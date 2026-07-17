const conversationRepository = require('../../infrastructure/database/conversation.repository');
const messageRepository = require('../../infrastructure/database/message.repository');

async function listMessages(conversationId) {
  const conversation = await conversationRepository.findConversationById(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }
  return messageRepository.findMessagesByConversation(conversationId);
}

module.exports = { listMessages };