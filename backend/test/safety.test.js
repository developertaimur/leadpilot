// Canary: if any of these fail, the test environment is not isolated. Fix this first.
const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');

afterEach(() => mock.restoreAll());

test('DATABASE_URL points at the unreachable test database', () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(process.env.DATABASE_URL.includes('leadpilot_test'));
  assert.equal(url.port, '1');
});

test('OPENWA_BASE_URL points at a dead local port', () => {
  const url = new URL(process.env.OPENWA_BASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '1');
});

test('external service credentials are the fake test values', () => {
  assert.equal(process.env.GEMINI_API_KEY, 'test-gemini-key');
  assert.equal(process.env.GROQ_API_KEY, 'test-groq-key');
  assert.equal(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH, './test/does-not-exist.json');
  assert.equal(process.env.OPENWA_API_KEY, 'test-openwa-api-key');
  assert.equal(process.env.OPENWA_SESSION_ID, 'test-openwa-session-id');
  assert.equal(process.env.OPENWA_WEBHOOK_SECRET, 'test-openwa-webhook-secret');
});

test('config/env.js exposes the fake values, not the real .env', () => {
  const env = require('../src/config/env');
  assert.ok(env.databaseUrl.includes('leadpilot_test'));
  assert.equal(env.geminiApiKey, 'test-gemini-key');
  assert.equal(env.groqApiKey, 'test-groq-key');
  assert.equal(env.openwaBaseUrl, 'http://127.0.0.1:1');
  assert.equal(env.openwaApiKey, 'test-openwa-api-key');
  assert.equal(env.openwaSessionId, 'test-openwa-session-id');
  assert.equal(env.openwaWebhookSecret, 'test-openwa-webhook-secret');
});

test('BATCH_* settings are the test values from test.env', () => {
  const env = require('../src/config/env');
  assert.equal(process.env.BATCH_DELAY_SECONDS, '7');
  assert.equal(process.env.BATCH_DAILY_CAP, '5');
  assert.equal(process.env.BATCH_MAX_CONSECUTIVE_FAILURES, '2');
  assert.deepEqual([env.batchDelaySeconds, env.batchDailyCap, env.batchMaxConsecutiveFailures], [7, 5, 2]);
});

test('no Meta WhatsApp settings remain in config/env.js', () => {
  const env = require('../src/config/env');
  assert.deepEqual(Object.keys(env).filter((key) => key.startsWith('whatsapp')), []);
});

test('fetch to a non-local URL is blocked (string, URL and Request)', async () => {
  const blocked = /Blocked outbound fetch/;
  await assert.rejects(fetch('https://example.com'), blocked);
  await assert.rejects(fetch(new URL('https://example.com/path')), blocked);
  await assert.rejects(fetch(new Request('https://graph.facebook.com/v21.0/x/messages')), blocked);
});

test('fetch to the OpenWA port is blocked even on local hosts (string, URL and Request)', async () => {
  const blocked = /Blocked outbound fetch/;
  await assert.rejects(fetch('http://127.0.0.1:2785/api/sessions'), blocked);
  await assert.rejects(fetch(new URL('http://localhost:2785/api/health')), blocked);
  await assert.rejects(fetch(new Request('http://[::1]:2785/api/sessions/x/messages/send-text')), blocked);
});

test('nothing answers on the dead OpenWA base URL', async () => {
  // Passes the guard (local, not 2785) and must fail at the network, not succeed.
  await assert.rejects(
    fetch(`${process.env.OPENWA_BASE_URL}/api/sessions/x`, { signal: AbortSignal.timeout(5000) }),
    (err) => err.name === 'TypeError' || err.name === 'TimeoutError',
  );
});

test('a fetch mock replaces the guard, and mock.restoreAll() puts the guard back', async () => {
  const guard = globalThis.fetch;
  const fake = mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }));
  const res = await fetch('http://127.0.0.1:2785/api/sessions');
  assert.equal(res.status, 200);
  assert.equal(fake.mock.callCount(), 1);
  mock.restoreAll();
  assert.equal(globalThis.fetch, guard);
  await assert.rejects(fetch('http://127.0.0.1:2785/api/sessions'), /Blocked outbound fetch/);
});
