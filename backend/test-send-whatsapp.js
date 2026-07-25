const { sendWhatsAppMessage } = require('./src/infrastructure/whatsapp/whatsapp.client');

async function run() {
  const result = await sendWhatsAppMessage('923162652701', 'Hello from LeadPilot code!');
  console.log(result);
}

run();