// Canary: if any of these fail, the test environment is not isolated. Fix this first.
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('DATABASE_URL points at the unreachable test database', () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(process.env.DATABASE_URL.includes('leadpilot_test'));
  assert.equal(url.port, '1');
});

test('external service credentials are the fake test values', () => {
  assert.equal(process.env.WHATSAPP_ACCESS_TOKEN, 'test-whatsapp-token');
  assert.equal(process.env.WHATSAPP_PHONE_NUMBER_ID, 'test-phone-number-id');
  assert.equal(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID, 'test-business-account-id');
  assert.equal(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, 'test-verify-token');
  assert.equal(process.env.GEMINI_API_KEY, 'test-gemini-key');
  assert.equal(process.env.GROQ_API_KEY, 'test-groq-key');
  assert.equal(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH, './test/does-not-exist.json');
});

test('config/env.js exposes the fake values, not the real .env', () => {
  const env = require('../src/config/env');
  assert.ok(env.databaseUrl.includes('leadpilot_test'));
  assert.equal(env.whatsappAccessToken, 'test-whatsapp-token');
  assert.equal(env.geminiApiKey, 'test-gemini-key');
  assert.equal(env.groqApiKey, 'test-groq-key');
});

test('fetch to a non-local URL is blocked (string, URL and Request)', async () => {
  const blocked = /Blocked outbound fetch/;
  await assert.rejects(fetch('https://example.com'), blocked);
  await assert.rejects(fetch(new URL('https://example.com/path')), blocked);
  await assert.rejects(fetch(new Request('https://graph.facebook.com/v21.0/x/messages')), blocked);
});
