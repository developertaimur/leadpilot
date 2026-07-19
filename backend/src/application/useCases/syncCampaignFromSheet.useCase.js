const campaignRepository = require('../../infrastructure/database/campaign.repository');
const leadRepository = require('../../infrastructure/database/lead.repository');
const { getSheetRows } = require('../../infrastructure/sheets/googleSheets.client');
const { normalizePhoneNumber } = require('../../domain/rules/phoneNumber.rules');

async function syncCampaignFromSheet(campaignId) {
  const campaign = await campaignRepository.findCampaignById(campaignId);
  if (!campaign) {
    throw new Error('Campaign not found');
  }
  if (!campaign.googleSheetId || !campaign.googleSheetTabName) {
    throw new Error('Campaign has no Google Sheet connected');
  }

  const rows = await getSheetRows(campaign.googleSheetId, campaign.googleSheetTabName);
  const result = { created: 0, updated: 0, skipped: [] };

  for (const row of rows) {
    const rawPhone = row['Phone Number'];
    const name = row['Lead Name'] || null;
    const source = row['Source'] || null;

    const normalized = normalizePhoneNumber(rawPhone, campaign.defaultRegion);
    if (!normalized.valid) {
      result.skipped.push({ row, reason: normalized.reason });
      continue;
    }

    const existingLead = await leadRepository.findLeadByPhone(normalized.e164);

    if (!existingLead) {
      await leadRepository.createLead({ name, phoneNumber: normalized.e164, source, campaignId });
      result.created++;
      continue;
    }

    if (existingLead.stage === 'NEW') {
      await leadRepository.updateLeadInfo(existingLead.id, { name, source });
      result.updated++;
      continue;
    }

    result.skipped.push({ row, reason: 'Lead already engaged past NEW, skipped per sync policy' });
  }

  return result;
}

module.exports = { syncCampaignFromSheet };