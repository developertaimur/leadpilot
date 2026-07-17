const createCampaignUseCase = require('../../application/useCases/createCampaign.useCase');
const listCampaignsUseCase = require('../../application/useCases/listCampaigns.useCase');
const getCampaignByIdUseCase = require('../../application/useCases/getCampaignById.useCase');
const updateCampaignStatusUseCase = require('../../application/useCases/updateCampaignStatus.useCase');
const sendBatchUseCase = require('../../application/useCases/sendBatch.useCase');

async function createCampaign(req, res) {
  try {
    const { name, source } = req.body || {};
    const campaign = await createCampaignUseCase.createCampaign({ name, source });
    res.status(201).json(campaign);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function listCampaigns(req, res) {
  const campaigns = await listCampaignsUseCase.listCampaigns();
  res.json(campaigns);
}

async function getCampaign(req, res) {
  try {
    const campaign = await getCampaignByIdUseCase.getCampaignById(Number(req.params.id));
    res.json(campaign);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function updateStatus(req, res) {
  try {
    const { status } = req.body || {};
    const campaign = await updateCampaignStatusUseCase.updateCampaignStatus(Number(req.params.id), status);
    res.json(campaign);
  } catch (err) {
    const code = err.message === 'Campaign not found' ? 404 : 400;
    res.status(code).json({ error: err.message });
  }
}

async function sendBatch(req, res) {
  try {
    const { count } = req.body || {};
    const result = await sendBatchUseCase.sendBatch(Number(req.params.id), Number(count));
    res.status(200).json(result);
  } catch (err) {
    const code = err.message === 'Campaign not found' ? 404 : 400;
    res.status(code).json({ error: err.message });
  }
}

module.exports = { createCampaign, listCampaigns, getCampaign, updateStatus, sendBatch };