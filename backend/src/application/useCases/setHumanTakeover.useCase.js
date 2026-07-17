const conversationRepository = require('../../infrastructure/database/conversation.repository');

async function setHumanTakeover(id, humanTakeover) {
  const conversation = await conversationRepository.findConversationById(id);
  if (!conversation) {
    throw new Error('Conversation not found');
  }
  return conversationRepository.setHumanTakeover(id, humanTakeover);
}

module.exports = { setHumanTakeover };