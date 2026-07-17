const campaignRepository = require('../../infrastructure/database/campaign.repository');

async function createCampaign({ name, source }) {
  const cleanName = name?.trim();
  if (!cleanName) {
    throw new Error('Campaign name is required');
  }
  return campaignRepository.createCampaign({ name: cleanName, source: source?.trim() || null });
}

module.exports = { createCampaign };