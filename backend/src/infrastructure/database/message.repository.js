const prisma = require('./prismaClient');

async function createMessage({ conversationId, sender, content, whatsappMessageId }) {
  return prisma.message.create({
    data: { conversationId, sender, content, whatsappMessageId: whatsappMessageId || undefined },
  });
}

async function findMessagesByConversation(conversationId) {
  return prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  });
}

async function findMessageByWhatsappId(whatsappMessageId) {
  return prisma.message.findUnique({ where: { whatsappMessageId } });
}

module.exports = { createMessage, findMessagesByConversation, findMessageByWhatsappId };