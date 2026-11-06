const leadRepository = require('../../infrastructure/database/lead.repository');
const { LeadStage } = require('@prisma/client');

async function listLeads(filters) {
  if (filters.stage && !Object.values(LeadStage).includes(filters.stage)) {
    throw new Error(`Invalid stage filter. Must be one of: ${Object.values(LeadStage).join(', ')}`);
  }
  if (filters.aiSuggestedStage && !Object.values(LeadStage).includes(filters.aiSuggestedStage)) {
    throw new Error(`Invalid aiSuggestedStage filter. Must be one of: ${Object.values(LeadStage).join(', ')}`);
  }
  return leadRepository.findAllLeads(filters);
}

module.exports = { listLeads };