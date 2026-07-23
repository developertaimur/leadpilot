const { sendWhatsAppMessage } = require('./src/infrastructure/whatsapp/whatsapp.client');

async function run() {
  const result = await sendWhatsAppMessage('923475029433', 'Hello from gymfinity!');
  console.log(result);
}

run();