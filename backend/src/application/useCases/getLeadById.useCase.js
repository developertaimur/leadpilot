const leadRepository = require('../../infrastructure/database/lead.repository');

async function getLeadById(id) {
  const lead = await leadRepository.findLeadById(id);
  if (!lead) {
    throw new Error('Lead not found');
  }
  return lead;
}

module.exports = { getLeadById };