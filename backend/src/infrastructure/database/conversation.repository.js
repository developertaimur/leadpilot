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

// The conversation and its lead, without the messages (the AI pipeline's lookups).
async function findConversationWithLead(id) {
  return prisma.conversation.findUnique({ where: { id }, include: { lead: true } });
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

// Conversations created since `since` for leads that belong to a campaign (the send-batch cap).
async function countRecentCampaignConversations(since) {
  return prisma.conversation.count({
    where: { createdAt: { gte: since }, lead: { campaignId: { not: null } } },
  });
}

// Deletes the conversation only while it has no messages. Returns how many were deleted (0 or 1).
async function deleteConversationIfEmpty(id) {
  const { count } = await prisma.conversation.deleteMany({ where: { id, messages: { none: {} } } });
  return count;
}

module.exports = {
  createConversation,
  findAllConversations,
  findConversationById,
  findConversationWithLead,
  findConversationByLeadId,
  setHumanTakeover,
  countRecentCampaignConversations,
  deleteConversationIfEmpty,
};