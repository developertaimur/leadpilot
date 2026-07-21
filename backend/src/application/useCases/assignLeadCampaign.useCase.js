const leadRepository = require('../../infrastructure/database/lead.repository');
const campaignRepository = require('../../infrastructure/database/campaign.repository');


async function assignLeadCampaign(id, campaignId) {
  const lead = await leadRepository.findLeadById(id);
  if (!lead) {
    throw new Error('Lead not found');
  }

  if (campaignId !== null && campaignId !== undefined) {
    const campaign = await campaignRepository.findCampaignById(campaignId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }
  }

  return leadRepository.updateLeadCampaign(id, campaignId ?? null);
}

module.exports = { assignLeadCampaign };