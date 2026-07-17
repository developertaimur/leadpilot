const express = require('express');
const { createMessage, listMessages } = require('../controllers/message.controller');

const router = express.Router();

router.post('/conversations/:conversationId/messages', createMessage);
router.get('/conversations/:conversationId/messages', listMessages);

module.exports = router;