const businessProfileRepository = require('../../infrastructure/database/businessProfile.repository');

async function setBusinessProfile({ name, context }) {
  if (!name || !name.trim()) throw new Error('Business name is required');
  if (!context || !context.trim()) throw new Error('Business context is required');
  return businessProfileRepository.upsertBusinessProfile({ name: name.trim(), context: context.trim() });
}

module.exports = { setBusinessProfile };