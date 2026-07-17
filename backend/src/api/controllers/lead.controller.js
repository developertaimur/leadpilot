const createLeadUseCase = require('../../application/useCases/createLead.useCase');
const listLeadsUseCase = require('../../application/useCases/listLeads.useCase');
const getLeadByIdUseCase = require('../../application/useCases/getLeadById.useCase');
const updateLeadStageUseCase = require('../../application/useCases/updateLeadStage.useCase');
const deleteLeadUseCase = require('../../application/useCases/deleteLead.useCase');
const updateLeadInfoUseCase = require('../../application/useCases/updateLeadInfo.useCase');
const getLeadStatsUseCase = require('../../application/useCases/getLeadStats.useCase');

async function createLead(req, res) {
  try {
    const lead = await createLeadUseCase.createLead(req.body);
    res.status(201).json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function listLeads(req, res) {
  try {
    const { stage, source, channel } = req.query;
    const leads = await listLeadsUseCase.listLeads({ stage, source, channel });
    res.json(leads);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function getStats(req, res) {
  const stats = await getLeadStatsUseCase.getLeadStats();
  res.json(stats);
}

async function getLead(req, res) {
  try {
    const id = Number(req.params.id);
    const lead = await getLeadByIdUseCase.getLeadById(id);
    res.json(lead);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function updateStage(req, res) {
  try {
    const id = Number(req.params.id);
    const { stage } = req.body;
    const lead = await updateLeadStageUseCase.updateLeadStage(id, stage);
    res.json(lead);
  } catch (err) {
    const status = err.message === 'Lead not found' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function removeLead(req, res) {
  try {
    const id = Number(req.params.id);
    await deleteLeadUseCase.deleteLead(id);
    res.status(204).send();
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function updateInfo(req, res) {
  try {
    const id = Number(req.params.id);
    const lead = await updateLeadInfoUseCase.updateLeadInfo(id, req.body);
    res.json(lead);
  } catch (err) {
    const status = err.message === 'Lead not found' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
}

module.exports = { createLead, listLeads, getLead, updateStage, removeLead, updateInfo, getStats };