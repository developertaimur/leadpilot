const { test, describe, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Groq = require('groq-sdk');
const env = require('../../src/config/env');
const { generateStructuredReply, GroqError } = require('../../src/infrastructure/ai/groq.client');
const { VALID_REPLY, INVALID_REPLY_TEXTS } = require('../helpers/invalidReplies');

const GROQ_ORIGIN = 'https://api.groq.com';
const COMPLETIONS_URL = `${GROQ_ORIGIN}/openai/v1/chat/completions`;
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
const KEY = 'test-groq-key'; // GROQ_API_KEY in test.env
const SYSTEM = 'You are Ayesha from the test gym. System marker 8812.';
const LEAD_TEXT = 'Salam, mera gym Karachi mein hai, marker 6643';
const REQUEST = {
  systemInstruction: SYSTEM,
  messages: [
    { role: 'user', text: LEAD_TEXT },
    { role: 'model', text: 'Shukriya! Kitne members hain?' },
    { role: 'user', text: 'Around 150' },
  ],
};
const EXPECTED = {
  reply: 'Great, 150 members! Would a free 7-day demo help?',
  suggestedStage: 'INTERESTED',
  reason: 'Shared the gym size',
  requiresHuman: false,
};
const EXPECTED_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    suggestedStage: {
      anyOf: [{ type: 'string', enum: ['NEW', 'CONTACTED', 'INTERESTED', 'QUALIFIED', 'CONVERTED', 'LOST'] }, { type: 'null' }],
    },
    reason: { type: 'string' },
    requiresHuman: { type: 'boolean' },
  },
  required: ['reply', 'suggestedStage', 'reason', 'requiresHuman'],
  additionalProperties: false,
};

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const completion = (choices) =>
  json(200, {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1767225600,
    model: 'openai/gpt-oss-20b',
    choices,
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
  });
const completionWith = (message, finishReason = 'stop') =>
  completion([{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finishReason }]);
const answerContent = (content, finishReason) => () => completionWith({ content }, finishReason);
const answerJson = (payload) => answerContent(JSON.stringify(payload));
const groqErrorBody = (status, message, type, code) => () => json(status, { error: { message, type, code } });
const flush = () => new Promise((resolve) => setImmediate(resolve));

let requests; // every URL fetched in the current round
let calls; // requests the fake Groq answered
let consoleSink; // where console lines go; test 32 points it elsewhere for its control run
const allConsoleOutput = []; // every console line from every test in this file

beforeEach(() => {
  consoleSink = allConsoleOutput;
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    mock.method(console, level, (...args) => consoleSink.push(`${level}: ${args.join(' ')}`));
  }
});
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

// Fakes only Groq's address; anything else goes on to the guarded fetch from test/setup.js.
// Returns the fetch mock, so a loop can undo just this round with `.mock.restore()`.
function fakeGroq(answer) {
  const guardedFetch = globalThis.fetch;
  requests = [];
  calls = [];
  return mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    if (url.origin === GROQ_ORIGIN) {
      calls.push({ url: url.href, init });
      return answer(init);
    }
    return guardedFetch(input, init);
  });
}

function assertStayedLocal() {
  for (const url of requests) {
    assert.ok(url.origin === GROQ_ORIGIN || LOCAL_HOSTS.includes(url.hostname), `request left the machine: ${url.hostname}`);
    assert.notEqual(url.port, '2785', 'request went to the real OpenWA port');
  }
}

function assertNoSecrets(err) {
  const seen = [err.message, String(err), JSON.stringify(err), err.stack ?? ''].join('\n');
  for (const secret of [KEY, SYSTEM, LEAD_TEXT, 'marker 6643', 'marker 8812']) {
    assert.ok(!seen.includes(secret), `error exposes "${secret}"`);
  }
}

async function expectGroqError(promise, code, status = null) {
  const err = await promise.then(
    () => assert.fail(`expected GroqError ${code}`),
    (e) => e,
  );
  assert.ok(err instanceof GroqError, `expected a GroqError, got ${err?.name}`);
  assert.equal(err.code, code);
  assert.equal(err.status, status);
  assertNoSecrets(err);
  assertStayedLocal();
  return err;
}

describe('Groq generateStructuredReply — valid output', () => {
  test('returns exactly the four fields, trimmed; extra fields dropped; a reasoning field is ignored', async () => {
    fakeGroq(() =>
      completionWith({
        content: JSON.stringify({ ...VALID_REPLY, confidence: 0.9 }),
        reasoning: 'The lead shared the gym size. {"reply":"not this one","requiresHuman":true}',
      }));

    assert.deepEqual(await generateStructuredReply(REQUEST), EXPECTED);
    assertStayedLocal();
  });

  test('suggestedStage null, an empty reason, and every one of the six stages are accepted', async () => {
    const first = fakeGroq(answerJson({ ...VALID_REPLY, suggestedStage: null, reason: '' }));
    assert.deepEqual(await generateStructuredReply(REQUEST), { ...EXPECTED, suggestedStage: null, reason: '' });
    first.mock.restore();

    for (const stage of ['NEW', 'CONTACTED', 'INTERESTED', 'QUALIFIED', 'CONVERTED', 'LOST']) {
      const fetchMock = fakeGroq(answerJson({ ...VALID_REPLY, suggestedStage: stage, requiresHuman: true }));
      const result = await generateStructuredReply(REQUEST);
      assert.equal(result.suggestedStage, stage);
      assert.equal(result.requiresHuman, true);
      fetchMock.mock.restore();
    }
  });

  test('sends one POST to the chat completions route: Bearer key, gpt-oss-20b, strict json_schema, low reasoning, 2048 tokens', async () => {
    fakeGroq(answerJson(VALID_REPLY));
    await generateStructuredReply(REQUEST);

    assert.equal(calls.length, 1);
    const [{ url, init }] = calls;
    assert.equal(url, COMPLETIONS_URL);
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${KEY}`);
    assert.ok(!url.includes(KEY), 'the key must not be in the URL');

    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body).sort(), [
      'max_completion_tokens',
      'messages',
      'model',
      'reasoning_effort',
      'response_format',
    ]);
    assert.equal(body.model, 'openai/gpt-oss-20b');
    assert.deepEqual(body.messages, [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: LEAD_TEXT },
      { role: 'assistant', content: 'Shukriya! Kitne members hain?' },
      { role: 'user', content: 'Around 150' },
    ]);
    assert.deepEqual(body.response_format, {
      type: 'json_schema',
      json_schema: { name: 'lead_reply', strict: true, schema: EXPECTED_SCHEMA },
    });
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.max_completion_tokens, 2048);
    assertStayedLocal();
  });
});

describe('Groq generateStructuredReply — invalid output is INVALID_RESPONSE', () => {
  for (const [label, text] of Object.entries(INVALID_REPLY_TEXTS)) {
    test(label, async () => {
      fakeGroq(answerContent(text));
      await expectGroqError(generateStructuredReply(REQUEST), 'INVALID_RESPONSE');
      assert.equal(calls.length, 1);
    });
  }

  test('no choices, content null, or a choice without a message', async () => {
    const answers = [
      () => completion([]),
      answerContent(null),
      () => completion([{ index: 0, finish_reason: 'stop' }]),
    ];
    for (const answer of answers) {
      const fetchMock = fakeGroq(answer);
      await expectGroqError(generateStructuredReply(REQUEST), 'INVALID_RESPONSE');
      fetchMock.mock.restore();
    }
  });

  test('finish_reason "length" with cut-off JSON (or no content left after reasoning) is INVALID_RESPONSE', async () => {
    let fetchMock = fakeGroq(answerContent('{"reply":"Great, 150 members! Would a free 7-d', 'length'));
    await expectGroqError(generateStructuredReply(REQUEST), 'INVALID_RESPONSE');
    fetchMock.mock.restore();

    fetchMock = fakeGroq(answerContent('', 'length'));
    await expectGroqError(generateStructuredReply(REQUEST), 'INVALID_RESPONSE');
  });

  test('a reply of exactly 4096 characters is still valid', async () => {
    fakeGroq(answerJson({ ...VALID_REPLY, reply: 'x'.repeat(4096) }));
    assert.equal((await generateStructuredReply(REQUEST)).reply.length, 4096);
  });
});

describe('Groq generateStructuredReply — errors', () => {
  test('HTTP 429 is QUOTA', async () => {
    fakeGroq(groqErrorBody(
      429,
      'Rate limit reached for model `openai/gpt-oss-20b` on tokens per minute (TPM). Please try again in 2s.',
      'tokens',
      'rate_limit_exceeded',
    ));
    await expectGroqError(generateStructuredReply(REQUEST), 'QUOTA', 429);
  });

  test('other 4xx and 5xx are API_ERROR with their status, never QUOTA', async () => {
    const answers = [
      [400, 'Generated JSON does not match the expected schema. Please adjust your prompt.', 'invalid_request_error', 'json_validate_failed'],
      [401, 'Invalid API Key', 'invalid_request_error', 'invalid_api_key'],
      [403, 'Forbidden', 'permission_error', 'forbidden'],
      [404, 'The model `openai/gpt-oss-20b` does not exist or you do not have access to it.', 'invalid_request_error', 'model_not_found'],
      [413, 'Request too large for model.', 'invalid_request_error', 'request_too_large'],
      [422, 'Unprocessable entity.', 'invalid_request_error', 'unprocessable_entity'],
      [500, 'Internal server error.', 'internal_server_error', 'internal_server_error'],
      [503, 'Service unavailable.', 'internal_server_error', 'service_unavailable'],
    ];
    for (const [status, message, type, code] of answers) {
      const fetchMock = fakeGroq(groqErrorBody(status, message, type, code));
      await expectGroqError(generateStructuredReply(REQUEST), 'API_ERROR', status);
      fetchMock.mock.restore();
    }
  });

  test('no retry: a 429, a 503 and a refused connection each make exactly one request', async () => {
    const answers = [
      groqErrorBody(429, 'Rate limit reached.', 'tokens', 'rate_limit_exceeded'),
      groqErrorBody(503, 'Service unavailable.', 'internal_server_error', 'service_unavailable'),
      () => {
        throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
      },
    ];
    for (const answer of answers) {
      const fetchMock = fakeGroq(answer);
      await generateStructuredReply(REQUEST).catch(() => {});
      assert.equal(calls.length, 1);
      fetchMock.mock.restore();
    }
  });

  test('a request still open after 20 s is TIMEOUT (mocked timers, no real waiting)', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    fakeGroq((init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    }));

    let settled = false;
    const pending = generateStructuredReply(REQUEST);
    pending.then(() => {}, () => {}).finally(() => {
      settled = true;
    });
    await flush();
    await flush();
    assert.equal(calls.length, 1);
    mock.timers.tick(19999);
    await flush();
    assert.equal(settled, false, 'must still be waiting at 19,999 ms');
    mock.timers.tick(1);
    await expectGroqError(pending, 'TIMEOUT');
    assert.equal(calls.length, 1);
  });

  test('a missing key is NOT_CONFIGURED, and Groq is never called', async () => {
    fakeGroq(() => {
      throw new Error('Groq must not be called');
    });
    mock.property(env, 'groqApiKey', '');
    await expectGroqError(generateStructuredReply(REQUEST), 'NOT_CONFIGURED');
    assert.equal(calls.length, 0);
  });

  test('a connection that was never made is UNREACHABLE; one that broke after connecting is API_ERROR', async () => {
    const neverConnected = [
      Object.assign(new Error('getaddrinfo ENOTFOUND api.groq.com'), { code: 'ENOTFOUND' }),
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    ];
    for (const cause of neverConnected) {
      const fetchMock = fakeGroq(() => {
        throw new TypeError('fetch failed', { cause });
      });
      await expectGroqError(generateStructuredReply(REQUEST), 'UNREACHABLE');
      fetchMock.mock.restore();
    }

    fakeGroq(() => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
    });
    await expectGroqError(generateStructuredReply(REQUEST), 'API_ERROR');
  });

  test("GROQ_BASE_URL, GROQ_API_KEY and GROQ_LOG=debug cannot redirect or unmute it (process.env restored exactly)", async () => {
    const overrides = { GROQ_BASE_URL: 'https://redirected.example', GROQ_LOG: 'debug' };
    const before = { ...process.env };
    try {
      Object.assign(process.env, overrides);
      fakeGroq(answerJson(VALID_REPLY));

      // Control: the same SDK without logLevel 'off' does print with GROQ_LOG=debug, so the silence below is real.
      const controlLines = [];
      consoleSink = controlLines;
      try {
        await new Groq({ apiKey: 'control-key', baseURL: GROQ_ORIGIN, maxRetries: 0 }).chat.completions.create({
          model: 'openai/gpt-oss-20b',
          messages: [{ role: 'user', content: 'control request' }],
        });
      } finally {
        consoleSink = allConsoleOutput;
      }
      assert.ok(controlLines.length > 0, 'with GROQ_LOG=debug the SDK should log when logLevel is not set');

      // Our client: its explicit key, base URL and logLevel 'off' win over all three variables.
      mock.property(env, 'groqApiKey', 'explicit-test-key');
      const linesBefore = allConsoleOutput.length;
      calls.length = 0;
      await generateStructuredReply(REQUEST);

      assert.equal(allConsoleOutput.length, linesBefore, 'our client must print nothing');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, COMPLETIONS_URL);
      assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer explicit-test-key');
      assertStayedLocal();
    } finally {
      for (const key of Object.keys(overrides)) {
        if (Object.hasOwn(before, key)) process.env[key] = before[key];
        else delete process.env[key];
      }
    }
    assert.deepEqual({ ...process.env }, before);
  });

  test('bad input from the caller is a plain TypeError, without any message text, and nothing is sent', async () => {
    fakeGroq(() => {
      throw new Error('Groq must not be called');
    });
    const badRequests = [
      undefined,
      { systemInstruction: SYSTEM },
      { systemInstruction: SYSTEM, messages: [] },
      { systemInstruction: '', messages: REQUEST.messages },
      { systemInstruction: SYSTEM, messages: [{ role: 'assistant', text: LEAD_TEXT }] },
      { systemInstruction: SYSTEM, messages: [{ role: 'user', text: 42 }] },
      { systemInstruction: SYSTEM, messages: [{ role: 'user', text: '   ' }] },
    ];
    for (const bad of badRequests) {
      const err = await generateStructuredReply(bad).then(() => assert.fail('expected a TypeError'), (e) => e);
      assert.ok(err instanceof TypeError && !(err instanceof GroqError));
      assert.ok(!err.message.includes(LEAD_TEXT) && !err.message.includes(SYSTEM));
    }
    assert.equal(calls.length, 0);
  });
});

test('no console output at all from any case in this file', () => {
  assert.deepEqual(allConsoleOutput, []);
});
