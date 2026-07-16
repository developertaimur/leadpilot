const express = require('express');
const { createLead, listLeads, getLead } = require('../controllers/lead.controller');

const router = express.Router();
router.post('/leads', createLead);
router.get('/leads', listLeads);
router.get('/leads/:id', getLead);

module.exports = router;