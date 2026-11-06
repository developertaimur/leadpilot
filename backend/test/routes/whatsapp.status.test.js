const { test, before, after, beforeEach, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/startApp');
const env = require('../../src/config/env');
const whatsappRoutes = require('../../src/api/routes/whatsapp.routes');

const OPENWA_ORIGIN = 'http://127.0.0.1:1'; // OPENWA_BASE_URL in test.env
const SESSION_URL = `${OPENWA_ORIGIN}/api/sessions/test-openwa-session-id`;
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

// What OpenWA's GET /api/sessions/{id} returns: none of it except `status` may reach our response.
const SESSION = {
  id: 'test-openwa-session-id',
  name: 'gymfinity-main',
  status: 'ready',
  phone: '6281234567890',
  pushName: 'Gymfinity Sales',
  connectedAt: '2026-11-06T08:00:00.000Z',
  lastActive: '2026-11-06T09:00:00.000Z',
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-06T09:00:00.000Z',
  lastError: 'Previous failure detail',
  restriction: null,
  engineLoaded: true,
};

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let app;
let logs;
let requests; // every URL fetched during the test, by the test or by the app
let openwaCalls; // requests the fake OpenWA answered

function captureConsole() {
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    mock.method(console, level, (...args) => logs.push(args.join(' ')));
  }
}

// For loops: undo this round's fetch/env mocks but keep capturing the console.
function resetMocks() {
  mock.restoreAll();
  captureConsole();
}

before(async () => {
  app = await startApp(whatsappRoutes);
});
after(() => app.close());
beforeEach(captureConsole);
afterEach(() => mock.restoreAll());

// Fakes only the fake OpenWA address; everything else (the test's own calls to the app) goes to the
// guarded fetch from test/setup.js.
function fakeOpenWA(answer) {
  const guardedFetch = globalThis.fetch;
  requests = [];
  openwaCalls = [];
  mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    if (url.origin === OPENWA_ORIGIN) {
      openwaCalls.push({ url: url.href, init });
      return answer();
    }
    return guardedFetch(input, init);
  });
}

// Calls our endpoint, then checks that nothing in this round left the machine or went to port 2785.
async function getStatus() {
  const res = await fetch(`${app.baseUrl}/api/whatsapp/status`);
  const text = await res.text();
  assert.ok(requests.length > 0);
  for (const url of requests) {
    assert.ok(LOCAL_HOSTS.includes(url.hostname), `request left the machine: ${url.hostname}`);
    assert.notEqual(url.port, '2785', 'request went to the real OpenWA port');
  }
  return { status: res.status, text, body: JSON.parse(text) };
}

test('ready: 200 with exactly the four fields, after one OpenWA call to the session route', async () => {
  fakeOpenWA(() => json(200, SESSION));
  const res = await getStatus();

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { configured: true, reachable: true, status: 'ready', ready: true });
  assert.equal(openwaCalls.length, 1);
  assert.equal(openwaCalls[0].url, SESSION_URL);
  assert.equal(openwaCalls[0].init.method, 'GET');
  assert.equal(openwaCalls[0].init.headers['X-API-Key'], 'test-openwa-api-key');
  assert.deepEqual(logs, []);
});

test('any other status is passed through with ready false', async () => {
  for (const status of ['qr_ready', 'disconnected', 'failed']) {
    fakeOpenWA(() => json(200, { ...SESSION, status }));
    const res = await getStatus();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { configured: true, reachable: true, status, ready: false });
    resetMocks();
  }
});

test('not configured: 200 configured false, and OpenWA is never called', async () => {
  for (const key of ['openwaBaseUrl', 'openwaApiKey', 'openwaSessionId']) {
    fakeOpenWA(() => {
      throw new Error('OpenWA must not be called');
    });
    mock.property(env, key, '');
    const res = await getStatus();
    assert.equal(res.status, 200, key);
    assert.deepEqual(res.body, { configured: false, reachable: false, status: null, ready: false }, key);
    assert.equal(openwaCalls.length, 0, key);
    assert.deepEqual(logs, [], key);
    resetMocks();
  }
  assert.equal(env.openwaApiKey, 'test-openwa-api-key'); // the env mocks were undone
});

test('unreachable: 200 reachable false', async () => {
  fakeOpenWA(() => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
  });
  const res = await getStatus();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { configured: true, reachable: false, status: null, ready: false });
  assert.deepEqual(logs, []);
});

test('timeout: 200 reachable false', async () => {
  fakeOpenWA(() => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  });
  const res = await getStatus();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { configured: true, reachable: false, status: null, ready: false });
  assert.deepEqual(logs, []);
});

test('OpenWA 401, 404 and 500 become 502 with no details', async () => {
  const answers = [
    [401, { statusCode: 401, message: 'Invalid API key', error: 'Unauthorized' }],
    [404, { statusCode: 404, message: "Session with id 'test-openwa-session-id' not found", error: 'Not Found' }],
    [500, { statusCode: 500, message: 'Internal server error', error: 'Internal Server Error' }],
  ];
  for (const [status, body] of answers) {
    fakeOpenWA(() => json(status, body));
    const res = await getStatus();
    assert.equal(res.status, 502, String(status));
    assert.deepEqual(res.body, { error: 'OpenWA error' });
    resetMocks();
  }
});

test('a 200 without a usable status becomes 502, logged as one line with only the code', async () => {
  const { status, ...withoutStatus } = SESSION;
  fakeOpenWA(() => json(200, withoutStatus));
  const res = await getStatus();
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: 'OpenWA error' });
  assert.deepEqual(logs, ['WhatsApp status check failed (INVALID_RESPONSE)']);
});

test('no other OpenWA field, id, phone, name or secret ever reaches the response body', async () => {
  fakeOpenWA(() => json(200, { ...SESSION, status: 'qr_ready' }));
  const res = await getStatus();

  assert.deepEqual(Object.keys(res.body).sort(), ['configured', 'reachable', 'ready', 'status']);
  const leaks = ['test-openwa-session-id', 'test-openwa-api-key', '6281234567890', 'Gymfinity Sales', 'gymfinity-main', 'Previous failure detail'];
  for (const value of leaks) {
    assert.ok(!res.text.includes(value), `response contains "${value}"`);
  }
});

test('the 502 log line holds the status code and nothing else', async () => {
  fakeOpenWA(() => json(401, { statusCode: 401, message: 'Invalid API key test-openwa-api-key', error: 'Unauthorized' }));
  await getStatus();

  assert.deepEqual(logs, ['WhatsApp status check failed (401)']);
  const output = logs.join('\n');
  for (const value of ['test-openwa-api-key', 'test-openwa-session-id', '6281234567890']) {
    assert.ok(!output.includes(value), `log contains "${value}"`);
  }
});
