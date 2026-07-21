const leadRepository = require('../../infrastructure/database/lead.repository');
const campaignRepository = require('../../infrastructure/database/campaign.repository');
const { normalizePhoneNumber } = require('../../domain/rules/phoneNumber.rules');
const { defaultPhoneRegion } = require('../../config/env');

async function updateLeadInfo(id, { name, phoneNumber, source }) {
  const lead = await leadRepository.findLeadById(id);
  if (!lead) {
    throw new Error('Lead not found');
  }

  const cleanName = name !== undefined ? name.trim() : undefined;
  const cleanSource = source !== undefined ? source.trim() : undefined;

  let cleanPhone;
  if (phoneNumber !== undefined) {
    let region = defaultPhoneRegion;
    if (lead.campaignId) {
      const campaign = await campaignRepository.findCampaignById(lead.campaignId);
      if (campaign?.defaultRegion) {
        region = campaign.defaultRegion;
      }
    }

    const normalized = normalizePhoneNumber(phoneNumber, region);
    if (!normalized.valid) {
      throw new Error(`Invalid phone number: ${normalized.reason}`);
    }
    cleanPhone = normalized.e164;

    if (cleanPhone !== lead.phoneNumber) {
      const existing = await leadRepository.findLeadByPhone(cleanPhone);
      if (existing) {
        throw new Error('Another lead already uses this phone number');
      }
    }
  }

  const data = {};
  if (cleanName !== undefined) data.name = cleanName;
  if (cleanPhone !== undefined) data.phoneNumber = cleanPhone;
  if (cleanSource !== undefined) data.source = cleanSource;

  return leadRepository.updateLeadInfo(id, data);
}

module.exports = { updateLeadInfo };