const {
  whatsappAccessToken,
  whatsappPhoneNumberId,
} = require('../../config/env');

async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v21.0/${whatsappPhoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${whatsappAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`WhatsApp API error: ${data.error?.message || 'Unknown error'}`);
  }

  return data;
}

module.exports = { sendWhatsAppMessage };