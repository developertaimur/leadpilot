const express = require('express');
const { verifyOpenWASignature } = require('../middleware/verifyOpenWASignature');
const { receiveWebhook, getStatus } = require('../controllers/whatsapp.controller');

const router = express.Router();

router.post('/whatsapp/webhook', verifyOpenWASignature, receiveWebhook);
router.get('/whatsapp/status', getStatus);

module.exports = router;
