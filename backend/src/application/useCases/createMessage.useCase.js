const conversationRepository = require('../../infrastructure/database/conversation.repository');
const messageRepository = require('../../infrastructure/database/message.repository');
const leadRepository = require('../../infrastructure/database/lead.repository');
const { channelSenders } = require('../../infrastructure/channels/channelSenders');
const { MessageSender } = require('@prisma/client');

async function createMessage(conversationId, { sender, content, whatsappMessageId }) {
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

  if (sender === 'AI' || sender === 'HUMAN') {
    const send = channelSenders[conversation.channel];
    if (!send) {
      throw new Error(`No sender configured for channel: ${conversation.channel}`);
    }
    await send(conversation.lead, content.trim());
  }

  const message = await messageRepository.createMessage({
    conversationId,
    sender,
    content: content.trim(),
    whatsappMessageId,
  });

  if ((sender === 'AI' || sender === 'HUMAN') && conversation.lead.stage === 'NEW') {
    await leadRepository.updateLeadStage(conversation.leadId, 'CONTACTED');
  }

  return message;
}

module.exports = { createMessage };