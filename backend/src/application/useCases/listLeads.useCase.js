const leadRepository = require('../../infrastructure/database/lead.repository');

async function listLeads() {
  return leadRepository.findAllLeads();
}

module.exports = { listLeads };