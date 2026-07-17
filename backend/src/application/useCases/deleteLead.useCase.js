const leadRepository = require('../../infrastructure/database/lead.repository');

async function deleteLead(id) {
  const lead = await leadRepository.findLeadById(id);
  if (!lead) {
    throw new Error('Lead not found');
  }
  return leadRepository.deleteLead(id);
}

module.exports = { deleteLead };