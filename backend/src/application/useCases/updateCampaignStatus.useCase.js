const campaignRepository = require('../../infrastructure/database/campaign.repository');
const { CampaignStatus } = require('@prisma/client');

async function updateCampaignStatus(id, status) {
  if (!Object.values(CampaignStatus).includes(status)) {
    throw new Error(`Invalid status. Must be one of: ${Object.values(CampaignStatus).join(', ')}`);
  }
  const campaign = await campaignRepository.findCampaignById(id);
  if (!campaign) {
    throw new Error('Campaign not found');
  }
  return campaignRepository.updateCampaignStatus(id, status);
}

module.exports = { updateCampaignStatus };