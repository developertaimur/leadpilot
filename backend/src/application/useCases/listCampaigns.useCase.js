const campaignRepository = require('../../infrastructure/database/campaign.repository');

async function listCampaigns() {
  return campaignRepository.findAllCampaigns();
}

module.exports = { listCampaigns };