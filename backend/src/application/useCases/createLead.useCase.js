const leadRepository = require('../../infrastructure/database/lead.repository');

// async function createLead({ name, phoneNumber, source }) {
//   const cleanPhone = phoneNumber?.trim();
//   const cleanName = name?.trim() || null;
//   const cleanSource = source?.trim() || null;

//   if (!cleanPhone) {
//     throw new Error('Phone number is required');
//   }

//   const existing = await leadRepository.findLeadByPhone(cleanPhone);
//   if (existing) {
//     throw new Error('A lead with this phone number already exists');
//   }

//   return leadRepository.createLead({ name: cleanName, phoneNumber: cleanPhone, source: cleanSource });
// }

async function createLead({ name, phoneNumber, source, campaignId }) {
  const cleanPhone = phoneNumber?.trim();
  const cleanName = name?.trim() || null;
  const cleanSource = source?.trim() || null;

  if (!cleanPhone) {
    throw new Error('Phone number is required');
  }

  const existing = await leadRepository.findLeadByPhone(cleanPhone);
  if (existing) {
    throw new Error('A lead with this phone number already exists');
  }

  return leadRepository.createLead({ name: cleanName, phoneNumber: cleanPhone, source: cleanSource, campaignId: campaignId ?? null });
}

module.exports = { createLead };