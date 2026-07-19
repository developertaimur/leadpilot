const campaignRepository = require('../../infrastructure/database/campaign.repository');

async function updateCampaignSheetConfig(id, { googleSheetId, googleSheetTabName, defaultRegion }) {
  const campaign = await campaignRepository.findCampaignById(id);
  if (!campaign) {
    throw new Error('Campaign not found');
  }

  const data = {};
  if (googleSheetId !== undefined) data.googleSheetId = googleSheetId;
  if (googleSheetTabName !== undefined) data.googleSheetTabName = googleSheetTabName;
  if (defaultRegion !== undefined) data.defaultRegion = defaultRegion;

  return campaignRepository.updateSheetConfig(id, data);
}

module.exports = { updateCampaignSheetConfig };