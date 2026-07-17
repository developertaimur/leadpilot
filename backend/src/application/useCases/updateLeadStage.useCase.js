const leadRepository = require('../../infrastructure/database/lead.repository');
const { LeadStage } = require('@prisma/client');

async function updateLeadStage(id, stage) {
  if (!Object.values(LeadStage).includes(stage)) {
    throw new Error(`Invalid stage. Must be one of: ${Object.values(LeadStage).join(', ')}`);
  }

  const lead = await leadRepository.findLeadById(id);
  if (!lead) {
    throw new Error('Lead not found');
  }

  return leadRepository.updateLeadStage(id, stage);
}

module.exports = { updateLeadStage };