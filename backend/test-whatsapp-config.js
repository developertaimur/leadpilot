const env = require('./src/config/env');
console.log({
  hasToken: !!env.whatsappAccessToken,
  phoneNumberId: env.whatsappPhoneNumberId,
  wabaId: env.whatsappBusinessAccountId,
  hasVerifyToken: !!env.whatsappWebhookVerifyToken,
});