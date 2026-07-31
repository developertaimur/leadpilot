const { sendWhatsAppMessage } = require('../whatsapp/whatsapp.client');

const channelSenders = {
  WHATSAPP: (lead, content) => sendWhatsAppMessage(lead.phoneNumber.replace('+', ''), content),
};

module.exports = { channelSenders };