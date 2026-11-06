const prisma = require('./prismaClient');
const { stageChangeData } = require('../../domain/rules/leadStage.rules');

// async function createLead({ name, phoneNumber, source }) {
//   return prisma.lead.create({
//     data: { name, phoneNumber, source },
//   });
// }

async function createLead({ name, phoneNumber, source, campaignId }) {
  return prisma.lead.create({ data: { name, phoneNumber, source, campaignId } });
}

async function findLeadByPhone(phoneNumber) {
  return prisma.lead.findUnique({ where: { phoneNumber } });
}

async function findAllLeads(filters = {}) {
  const where = {};
  if (filters.stage) where.stage = filters.stage;
  if (filters.source) where.source = filters.source;
  if (filters.channel === 'outbound') where.campaignId = { not: null };
  if (filters.channel === 'inbound') where.campaignId = null;
  if (filters.aiSuggestedStage) where.aiSuggestedStage = filters.aiSuggestedStage;

  return prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' } });
}



async function findLeadById(id) {
  return prisma.lead.findUnique({ where: { id } });
}

// The only function that writes Lead.stage; every stage change also clears the AI suggestion.
async function updateLeadStage(id, stage) {
  return prisma.lead.update({ where: { id }, data: stageChangeData(stage) });
}

// Writes only the two AI suggestion fields, never stage.
async function updateAiSuggestion(id, aiSuggestedStage, aiSuggestionReason) {
  return prisma.lead.update({ where: { id }, data: { aiSuggestedStage, aiSuggestionReason } });
}

async function deleteLead(id) {
  return prisma.lead.delete({ where: { id } });
}

async function updateLeadInfo(id, data) {
  return prisma.lead.update({ where: { id }, data });
}

async function getLeadStats() {
  const [total, outbound, inbound, converted, lost, stageGroups] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { campaignId: { not: null } } }),
    prisma.lead.count({ where: { campaignId: null } }),
    prisma.lead.count({ where: { stage: 'CONVERTED' } }),
    prisma.lead.count({ where: { stage: 'LOST' } }),
    prisma.lead.groupBy({ by: ['stage'], _count: true }),
  ]);

  const byStage = { NEW: 0, CONTACTED: 0, INTERESTED: 0, QUALIFIED: 0, CONVERTED: 0, LOST: 0 };
  stageGroups.forEach((g) => { byStage[g.stage] = g._count; });

  return { total, outbound, inbound, converted, lost, byStage };
}

async function updateLeadCampaign(id, campaignId) {
  return prisma.lead.update({ where: { id }, data: { campaignId } });
}

module.exports = { createLead, findLeadByPhone, findAllLeads, findLeadById, updateLeadStage, deleteLead, updateLeadInfo, getLeadStats, updateLeadCampaign, updateAiSuggestion };