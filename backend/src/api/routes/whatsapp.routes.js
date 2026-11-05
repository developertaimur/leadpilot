const express = require('express');
const { verifyOpenWASignature } = require('../middleware/verifyOpenWASignature');
const { receiveWebhook } = require('../controllers/whatsapp.controller');

const router = express.Router();

router.post('/whatsapp/webhook', verifyOpenWASignature, receiveWebhook);

module.exports = router;
