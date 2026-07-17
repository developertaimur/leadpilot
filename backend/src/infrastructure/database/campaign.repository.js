const prisma = require('./prismaClient');

async function createCampaign({ name, source }) {
  return prisma.campaign.create({ data: { name, source } });
}

async function findAllCampaigns() {
  return prisma.campaign.findMany({
    include: { _count: { select: { leads: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function findCampaignById(id) {
  return prisma.campaign.findUnique({ where: { id } });
}

async function findCampaignWithLeads(id) {
  return prisma.campaign.findUnique({ where: { id }, include: { leads: true } });
}

async function updateCampaignStatus(id, status) {
  return prisma.campaign.update({ where: { id }, data: { status } });
}

async function findLeadsForBatch(campaignId, count) {
  return prisma.lead.findMany({
    where: { campaignId, stage: 'NEW', conversation: null },
    take: count,
    orderBy: { createdAt: 'asc' },
  });
}

module.exports = {
  createCampaign,
  findAllCampaigns,
  findCampaignById,
  findCampaignWithLeads,
  updateCampaignStatus,
  findLeadsForBatch,
};