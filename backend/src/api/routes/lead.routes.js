const express = require('express');
const { createLead, listLeads, getLead, updateStage, removeLead, updateInfo, getStats, assignCampaign } = require('../controllers/lead.controller');

const router = express.Router();
router.post('/leads', createLead);
router.get('/leads/stats', getStats);
router.get('/leads', listLeads);
router.get('/leads/:id', getLead);
router.patch('/leads/:id/stage', updateStage);
router.delete('/leads/:id', removeLead);
router.patch('/leads/:id', updateInfo);
router.patch('/leads/:id/campaign', assignCampaign);


module.exports = router;