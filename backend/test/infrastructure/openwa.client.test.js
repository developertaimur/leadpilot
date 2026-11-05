const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const env = require('../../src/config/env');
const { sendText, resolveLidPhone, OpenWAError } = require('../../src/infrastructure/whatsapp/openwa.client');

const SEND_URL = 'http://127.0.0.1:1/api/sessions/test-openwa-session-id/messages/send-text';

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

afterEach(() => mock.restoreAll());

describe('openwaClient.sendText', () => {
  test('posts the text to the session send-text route and returns messageId and timestamp', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      jsonResponse(201, { messageId: 'true_923001234567@c.us_3EB0ABCD', timestamp: 1719312000 }));

    const result = await sendText('923001234567@c.us', 'Hello');

    assert.deepEqual(result, { messageId: 'true_923001234567@c.us_3EB0ABCD', timestamp: 1719312000 });
    assert.equal(fetchMock.mock.callCount(), 1);
    const [url, init] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, SEND_URL);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['X-API-Key'], 'test-openwa-api-key');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body), { chatId: '923001234567@c.us', text: 'Hello' });
    assert.ok(init.signal instanceof AbortSignal);
  });

  test('a success without messageId still resolves, with nulls', async () => {
    mock.method(globalThis, 'fetch', async () => jsonResponse(201, {}));
    assert.deepEqual(await sendText('923001234567@c.us', 'Hi'), { messageId: null, timestamp: null });
  });

  test('an error response becomes an OpenWAError with the status and message, without the API key', async () => {
    mock.method(globalThis, 'fetch', async () =>
      jsonResponse(400, { statusCode: 400, message: 'Session is not active', error: 'Bad Request' }));
    await assert.rejects(sendText('923001234567@c.us', 'Hi'), (err) => {
      assert.ok(err instanceof OpenWAError);
      assert.equal(err.status, 400);
      assert.equal(err.message, 'OpenWA error 400: Session is not active');
      assert.ok(!err.message.includes('test-openwa-api-key'));
      return true;
    });
  });

  test('a validation message array is joined', async () => {
    mock.method(globalThis, 'fetch', async () =>
      jsonResponse(400, {
        statusCode: 400,
        message: ['chatId should not be empty', 'text must be a string'],
        error: 'Bad Request',
      }));
    await assert.rejects(sendText('923001234567@c.us', 'Hi'), {
      message: 'OpenWA error 400: chatId should not be empty; text must be a string',
    });
  });

  test('a pacing refusal keeps the code and retryAfterSeconds', async () => {
    mock.method(globalThis, 'fetch', async () =>
      jsonResponse(429, {
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Daily allowance of 5 new conversation(s) reached',
        code: 'SEND_PACING_LIMITED',
        retryAfterSeconds: 34521,
      }));
    await assert.rejects(sendText('923001234567@c.us', 'Hi'), {
      name: 'OpenWAError',
      status: 429,
      code: 'SEND_PACING_LIMITED',
      retryAfterSeconds: 34521,
    });
  });

  test('a throttler 429 without a code falls back to the Retry-After header', async () => {
    mock.method(globalThis, 'fetch', async () =>
      jsonResponse(429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' }, { 'Retry-After': '30' }));
    await assert.rejects(sendText('923001234567@c.us', 'Hi'), { status: 429, code: null, retryAfterSeconds: 30 });
  });

  test('a network failure becomes UNREACHABLE', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await assert.rejects(sendText('923001234567@c.us', 'Hi'), {
      name: 'OpenWAError',
      code: 'UNREACHABLE',
      status: null,
      message: 'OpenWA is unreachable',
    });
  });

  test('a timeout becomes TIMEOUT', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    await assert.rejects(sendText('923001234567@c.us', 'Hi'), {
      name: 'OpenWAError',
      code: 'TIMEOUT',
      message: 'OpenWA did not answer within 20000 ms',
    });
  });

  test('missing config fails with NOT_CONFIGURED before any request', async () => {
    const fetchMock = mock.method(globalThis, 'fetch');
    mock.property(env, 'openwaApiKey', '');
    await assert.rejects(sendText('923001234567@c.us', 'Hi'), { code: 'NOT_CONFIGURED' });
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  test('text over 4096 characters is rejected before any request', async () => {
    const fetchMock = mock.method(globalThis, 'fetch');
    await assert.rejects(sendText('923001234567@c.us', 'x'.repeat(4097)), { code: 'INVALID_TEXT' });
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});

describe('openwaClient.resolveLidPhone', () => {
  test('GETs the contact phone route for the encoded id and returns the digits', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      jsonResponse(200, { contactId: '1234567890@lid', phone: '923001234567' }));

    assert.equal(await resolveLidPhone('1234567890@lid'), '923001234567');
    const [url, init] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, 'http://127.0.0.1:1/api/sessions/test-openwa-session-id/contacts/1234567890%40lid/phone');
    assert.equal(init.method, 'GET');
    assert.equal(init.headers['X-API-Key'], 'test-openwa-api-key');
    assert.equal(init.headers['Content-Type'], undefined);
    assert.equal(init.body, undefined);
  });

  test('returns null when OpenWA has no phone or answers with something that is not digits', async () => {
    for (const phone of [null, '', 'unknown', '12']) {
      mock.method(globalThis, 'fetch', async () => jsonResponse(200, { contactId: '1234567890@lid', phone }));
      assert.equal(await resolveLidPhone('1234567890@lid'), null);
      mock.restoreAll();
    }
  });
});
