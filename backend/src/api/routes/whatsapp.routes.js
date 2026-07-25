const express = require('express');
const { verifyWebhook, receiveWebhook } = require('../controllers/whatsapp.controller');

const router = express.Router();

router.get('/whatsapp/webhook', verifyWebhook);
router.post('/whatsapp/webhook', receiveWebhook);

module.exports = router;