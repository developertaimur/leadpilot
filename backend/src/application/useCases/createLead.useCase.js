const leadRepository = require('../../infrastructure/database/lead.repository');
const campaignRepository = require('../../infrastructure/database/campaign.repository');
const { normalizePhoneNumber } = require('../../domain/rules/phoneNumber.rules');
const { defaultPhoneRegion } = require('../../config/env');

async function createLead({ name, phoneNumber, source, campaignId }) {
  const cleanName = name?.trim() || null;
  const cleanSource = source?.trim() || null;

  let region = defaultPhoneRegion;
  if (campaignId) {
    const campaign = await campaignRepository.findCampaignById(campaignId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }
    if (campaign.defaultRegion) {
      region = campaign.defaultRegion;
    }
  }

  const normalized = normalizePhoneNumber(phoneNumber, region);
  if (!normalized.valid) {
    throw new Error(`Invalid phone number: ${normalized.reason}`);
  }

  const existing = await leadRepository.findLeadByPhone(normalized.e164);
  if (existing) {
    throw new Error('A lead with this phone number already exists');
  }

  return leadRepository.createLead({
    name: cleanName,
    phoneNumber: normalized.e164,
    source: cleanSource,
    campaignId: campaignId ?? null,
  });
}

module.exports = { createLead };