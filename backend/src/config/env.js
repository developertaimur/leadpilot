require('dotenv').config();

module.exports = {
  port: process.env.PORT || 5000,
  googleServiceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  databaseUrl: process.env.DATABASE_URL,
  defaultPhoneRegion: process.env.DEFAULT_PHONE_REGION || 'PK',
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  whatsappWebhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  openwaBaseUrl: process.env.OPENWA_BASE_URL,
  openwaApiKey: process.env.OPENWA_API_KEY,
  openwaSessionId: process.env.OPENWA_SESSION_ID,
  openwaWebhookSecret: process.env.OPENWA_WEBHOOK_SECRET,
  geminiApiKey: process.env.GEMINI_API_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
};