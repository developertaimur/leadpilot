const express = require('express');
const {
  createConversation,
  listConversations,
  getConversation,
  getConversationForLead,
  updateTakeover,
} = require('../controllers/conversation.controller');

const router = express.Router();

router.post('/conversations', createConversation);
router.get('/conversations/by-lead/:leadId', getConversationForLead);
router.get('/conversations', listConversations);
router.get('/conversations/:id', getConversation);
router.patch('/conversations/:id/takeover', updateTakeover);

module.exports = router;