const openwaClient = require('../whatsapp/openwa.client');
const { toChatId } = require('../../domain/rules/whatsappChatId.rules');

const channelSenders = {
  WHATSAPP: (lead, content) => openwaClient.sendText(toChatId(lead.phoneNumber), content),
};

module.exports = { channelSenders };
