const express = require('express');
const { verifyWebhook } = require('../controllers/whatsapp.controller');

const router = express.Router();

router.get('/whatsapp/webhook', verifyWebhook);

module.exports = router;