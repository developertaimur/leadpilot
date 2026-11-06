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

// The last `limit` messages of a conversation, oldest first. Newest first with take, then reversed;
// id breaks ties between messages saved in the same millisecond.
async function findLastMessagesByConversation(conversationId, limit) {
  const newestFirst = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  return newestFirst.reverse();
}

async function findMessageByWhatsappId(whatsappMessageId) {
  return prisma.message.findUnique({ where: { whatsappMessageId } });
}

module.exports = { createMessage, findMessagesByConversation, findLastMessagesByConversation, findMessageByWhatsappId };