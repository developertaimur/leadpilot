const createLeadUseCase = require('../../application/useCases/createLead.useCase');

async function createLead(req, res) {
  try {
    const lead = await createLeadUseCase.createLead(req.body);
    res.status(201).json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { createLead };