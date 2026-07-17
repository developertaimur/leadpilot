const campaignRepository = require('../../infrastructure/database/campaign.repository');

async function getCampaignById(id) {
  const campaign = await campaignRepository.findCampaignWithLeads(id);
  if (!campaign) {
    throw new Error('Campaign not found');
  }
  return campaign;
}

module.exports = { getCampaignById };