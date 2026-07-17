const leadRepository = require('../../infrastructure/database/lead.repository');

async function updateLeadInfo(id, { name, phoneNumber, source }) {
  const lead = await leadRepository.findLeadById(id);
  if (!lead) {
    throw new Error('Lead not found');
  }

  if (phoneNumber && phoneNumber !== lead.phoneNumber) {
    const existing = await leadRepository.findLeadByPhone(phoneNumber);
    if (existing) {
      throw new Error('Another lead already uses this phone number');
    }
  }

  const data = {};
  if (name !== undefined) data.name = name;
  if (phoneNumber !== undefined) data.phoneNumber = phoneNumber;
  if (source !== undefined) data.source = source;

  return leadRepository.updateLeadInfo(id, data);
}

module.exports = { updateLeadInfo };