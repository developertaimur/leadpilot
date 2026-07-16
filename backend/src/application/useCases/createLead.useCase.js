const leadRepository = require('../../infrastructure/database/lead.repository');

async function createLead({ name, phoneNumber, source }) {
  if (!phoneNumber) {
    throw new Error('Phone number is required');
  }

  const existing = await leadRepository.findLeadByPhone(phoneNumber);
  if (existing) {
    throw new Error('A lead with this phone number already exists');
  }

  return leadRepository.createLead({ name, phoneNumber, source });
}



module.exports = { createLead };