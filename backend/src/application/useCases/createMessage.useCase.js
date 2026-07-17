const conversationRepository = require('../../infrastructure/database/conversation.repository');
const messageRepository = require('../../infrastructure/database/message.repository');
const leadRepository = require('../../infrastructure/database/lead.repository');
const { MessageSender } = require('@prisma/client');

async function createMessage(conversationId, { sender, content }) {
  if (!Object.values(MessageSender).includes(sender)) {
    throw new Error(`Invalid sender. Must be one of: ${Object.values(MessageSender).join(', ')}`);
  }
  if (!content || !content.trim()) {
    throw new Error('Message content is required');
  }

  const conversation = await conversationRepository.findConversationById(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const message = await messageRepository.createMessage({
    conversationId,
    sender,
    content: content.trim(),
  });

  if ((sender === 'AI' || sender === 'HUMAN') && conversation.lead.stage === 'NEW') {
    await leadRepository.updateLeadStage(conversation.leadId, 'CONTACTED');
  }

  return message;
}

module.exports = { createMessage };