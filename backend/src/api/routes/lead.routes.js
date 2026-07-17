const express = require('express');
const { createLead, listLeads, getLead, updateStage, removeLead, updateInfo } = require('../controllers/lead.controller');

const router = express.Router();
router.post('/leads', createLead);
router.get('/leads', listLeads);
router.get('/leads/:id', getLead);
router.patch('/leads/:id/stage', updateStage);
router.delete('/leads/:id', removeLead);
router.patch('/leads/:id', updateInfo);

module.exports = router;