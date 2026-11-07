require('dotenv').config();

// Whole numbers above zero; anything else (missing, empty, zero, negative, not a number) uses the fallback.
function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

module.exports = {
  port: process.env.PORT || 5000,
  googleServiceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  databaseUrl: process.env.DATABASE_URL,
  defaultPhoneRegion: process.env.DEFAULT_PHONE_REGION || 'PK',
  openwaBaseUrl: process.env.OPENWA_BASE_URL,
  openwaApiKey: process.env.OPENWA_API_KEY,
  openwaSessionId: process.env.OPENWA_SESSION_ID,
  openwaWebhookSecret: process.env.OPENWA_WEBHOOK_SECRET,
  batchDelaySeconds: positiveInteger(process.env.BATCH_DELAY_SECONDS, 45),
  batchDailyCap: positiveInteger(process.env.BATCH_DAILY_CAP, 20),
  batchMaxConsecutiveFailures: positiveInteger(process.env.BATCH_MAX_CONSECUTIVE_FAILURES, 3),
  geminiApiKey: process.env.GEMINI_API_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
  // AI auto-replies to inbound WhatsApp messages: on only for "true" (trimmed, any case); anything else is off.
  aiAutoReplyEnabled: String(process.env.AI_AUTO_REPLY_ENABLED ?? '').trim().toLowerCase() === 'true',
};