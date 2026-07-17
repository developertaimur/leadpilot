const leadRepository = require('../../infrastructure/database/lead.repository');

async function getLeadStats() {
  return leadRepository.getLeadStats();
}

module.exports = { getLeadStats };