const createMessageUseCase = require('../../application/useCases/createMessage.useCase');
const listMessagesUseCase = require('../../application/useCases/listMessages.useCase');

async function createMessage(req, res) {
  try {
    const conversationId = Number(req.params.conversationId);
    const { sender, content } = req.body || {};
    const message = await createMessageUseCase.createMessage(conversationId, { sender, content });
    res.status(201).json(message);
  } catch (err) {
    const status = err.message === 'Conversation not found' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function listMessages(req, res) {
  try {
    const conversationId = Number(req.params.conversationId);
    const messages = await listMessagesUseCase.listMessages(conversationId);
    res.json(messages);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

module.exports = { createMessage, listMessages };