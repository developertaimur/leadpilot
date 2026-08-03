const setBusinessProfileUseCase = require('../../application/useCases/setBusinessProfile.useCase');
const businessProfileRepository = require('../../infrastructure/database/businessProfile.repository');

async function setProfile(req, res) {
  try {
    const { name, context } = req.body || {};
    const profile = await setBusinessProfileUseCase.setBusinessProfile({ name, context });
    res.json(profile);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function getProfile(req, res) {
  const profile = await businessProfileRepository.getBusinessProfile();
  if (!profile) return res.status(404).json({ error: 'No business profile set yet' });
  res.json(profile);
}

module.exports = { setProfile, getProfile };