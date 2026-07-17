const prisma = require('./prismaClient');

async function createConversation(leadId) {
  return prisma.conversation.create({ data: { leadId } });
}

async function findAllConversations() {
  return prisma.conversation.findMany({
    include: { lead: true },
    orderBy: { createdAt: 'desc' },
  });
}

async function findConversationById(id) {
  return prisma.conversation.findUnique({
    where: { id },
    include: { lead: true, messages: { orderBy: { createdAt: 'asc' } } },
  });
}

async function findConversationByLeadId(leadId) {
  return prisma.conversation.findUnique({
    where: { leadId },
    include: { lead: true, messages: { orderBy: { createdAt: 'asc' } } },
  });
}

async function setHumanTakeover(id, humanTakeover) {
  return prisma.conversation.update({ where: { id }, data: { humanTakeover } });
}

module.exports = {
  createConversation,
  findAllConversations,
  findConversationById,
  findConversationByLeadId,
  setHumanTakeover,
};