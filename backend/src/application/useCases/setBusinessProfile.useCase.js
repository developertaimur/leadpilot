const businessProfileRepository = require('../../infrastructure/database/businessProfile.repository');

async function setBusinessProfile({ name, context, salesInstructions }) {
  const data = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('name must be a non-empty string');
    data.name = name.trim();
  }
  if (context !== undefined) {
    if (typeof context !== 'string' || !context.trim()) throw new Error('context must be a non-empty string');
    data.context = context.trim();
  }
  if (salesInstructions !== undefined) {
    if (salesInstructions !== null && typeof salesInstructions !== 'string') {
      throw new Error('salesInstructions must be a string or null');
    }
    data.salesInstructions = salesInstructions?.trim() || null;
  }

  const existing = await businessProfileRepository.getBusinessProfile();
  if (!existing) {
    if (data.name === undefined || data.context === undefined) {
      throw new Error('name and context are required to create the business profile');
    }
    return businessProfileRepository.createBusinessProfile(data);
  }

  if (Object.keys(data).length === 0) {
    throw new Error('Provide at least one of: name, context, salesInstructions');
  }
  return businessProfileRepository.updateBusinessProfile(existing.id, data);
}

module.exports = { setBusinessProfile };
