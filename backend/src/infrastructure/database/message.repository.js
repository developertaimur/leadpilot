const prisma = require('./prismaClient');

async function createMessage({ conversationId, sender, content }) {
  return prisma.message.create({ data: { conversationId, sender, content } });
}

async function findMessagesByConversation(conversationId) {
  return prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  });
}

module.exports = { createMessage, findMessagesByConversation };