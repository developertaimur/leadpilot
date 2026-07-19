const express = require('express');
const { createCampaign, listCampaigns, getCampaign, updateStatus, sendBatch, updateSheetConfig} = require('../controllers/campaign.controller');

const router = express.Router();

router.post('/campaigns', createCampaign);
router.get('/campaigns', listCampaigns);
router.get('/campaigns/:id', getCampaign);
router.patch('/campaigns/:id/status', updateStatus);
router.post('/campaigns/:id/send-batch', sendBatch);
router.patch('/campaigns/:id/sheet-config', updateSheetConfig);

module.exports = router;