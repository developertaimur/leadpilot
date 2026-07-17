const createConversationUseCase = require('../../application/useCases/createConversation.useCase');
const listConversationsUseCase = require('../../application/useCases/listConversations.useCase');
const getConversationByIdUseCase = require('../../application/useCases/getConversationById.useCase');
const getConversationByLeadUseCase = require('../../application/useCases/getConversationByLead.useCase');
const setHumanTakeoverUseCase = require('../../application/useCases/setHumanTakeover.useCase');

async function createConversation(req, res) {
  try {
    const { leadId } = req.body;
    const conversation = await createConversationUseCase.createConversation(Number(leadId));
    res.status(201).json(conversation);
  } catch (err) {
    const status = err.message === 'Lead not found' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function listConversations(req, res) {
  const conversations = await listConversationsUseCase.listConversations();
  res.json(conversations);
}

async function getConversation(req, res) {
  try {
    const conversation = await getConversationByIdUseCase.getConversationById(Number(req.params.id));
    res.json(conversation);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function getConversationForLead(req, res) {
  try {
    const conversation = await getConversationByLeadUseCase.getConversationByLead(Number(req.params.leadId));
    res.json(conversation);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function updateTakeover(req, res) {
  try {
    const { humanTakeover } = req.body;
    const conversation = await setHumanTakeoverUseCase.setHumanTakeover(Number(req.params.id), humanTakeover);
    res.json(conversation);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

module.exports = { createConversation, listConversations, getConversation, getConversationForLead, updateTakeover };