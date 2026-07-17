const leadRepository = require('../../infrastructure/database/lead.repository');

async function updateLeadInfo(id, { name, phoneNumber, source }) {
  const lead = await leadRepository.findLeadById(id);
  if (!lead) {
    throw new Error('Lead not found');
  }

  const cleanPhone = phoneNumber !== undefined ? phoneNumber.trim() : undefined;
  const cleanName = name !== undefined ? name.trim() : undefined;
  const cleanSource = source !== undefined ? source.trim() : undefined;

  if (cleanPhone && cleanPhone !== lead.phoneNumber) {
    const existing = await leadRepository.findLeadByPhone(cleanPhone);
    if (existing) {
      throw new Error('Another lead already uses this phone number');
    }
  }

  const data = {};
  if (cleanName !== undefined) data.name = cleanName;
  if (cleanPhone !== undefined) data.phoneNumber = cleanPhone;
  if (cleanSource !== undefined) data.source = cleanSource;

  return leadRepository.updateLeadInfo(id, data);
}

module.exports = { updateLeadInfo };