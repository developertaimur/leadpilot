const express = require('express');
const { createLead } = require('../controllers/lead.controller');

const router = express.Router();
router.post('/leads', createLead);

module.exports = router;