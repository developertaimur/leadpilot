const { test, describe, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const env = require('../../src/config/env');
const { generateStructuredReply, GeminiError } = require('../../src/infrastructure/ai/gemini.client');

const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';
const GENERATE_URL = `${GEMINI_ORIGIN}/v1beta/models/gemini-3.5-flash:generateContent`;
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
const KEY = 'test-gemini-key'; // GEMINI_API_KEY in test.env
const SYSTEM = 'You are Ayesha from the test gym. System marker 7781.';
const LEAD_TEXT = 'Salam, mera gym Lahore mein hai, marker 4432';
const REQUEST = {
  systemInstruction: SYSTEM,
  messages: [
    { role: 'user', text: LEAD_TEXT },
    { role: 'model', text: 'Shukriya! Kitne members hain?' },
    { role: 'user', text: 'Around 150' },
  ],
};
const VALID = {
  reply: '  Great, 150 members! Would a free 7-day demo help?  ',
  suggestedStage: 'INTERESTED',
  reason: '  Shared the gym size  ',
  requiresHuman: false,
};

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const candidateWith = (parts) => json(200, { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] });
const answerJson = (payload) => () => candidateWith([{ text: JSON.stringify(payload) }]);
const answerText = (text) => () => candidateWith([{ text }]);
const flush = () => new Promise((resolve) => setImmediate(resolve));

let requests; // every URL fetched in the current round
let calls; // requests the fake Gemini answered
const allConsoleOutput = []; // every console line from every test in this file

beforeEach(() => {
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    mock.method(console, level, (...args) => allConsoleOutput.push(`${level}: ${args.join(' ')}`));
  }
});
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

// Fakes only Gemini's address; anything else goes on to the guarded fetch from test/setup.js.
// Returns the fetch mock, so a loop can undo just this round with `.mock.restore()`.
function fakeGemini(answer) {
  const guardedFetch = globalThis.fetch;
  requests = [];
  calls = [];
  return mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    if (url.origin === GEMINI_ORIGIN) {
      calls.push({ url: url.href, init });
      return answer(init);
    }
    return guardedFetch(input, init);
  });
}

function assertStayedLocal() {
  for (const url of requests) {
    assert.ok(url.origin === GEMINI_ORIGIN || LOCAL_HOSTS.includes(url.hostname), `request left the machine: ${url.hostname}`);
    assert.notEqual(url.port, '2785', 'request went to the real OpenWA port');
  }
}

function assertNoSecrets(err) {
  const seen = [err.message, String(err), JSON.stringify(err), err.stack ?? ''].join('\n');
  for (const secret of [KEY, SYSTEM, LEAD_TEXT, 'marker 4432', 'marker 7781']) {
    assert.ok(!seen.includes(secret), `error exposes "${secret}"`);
  }
}

async function expectGeminiError(promise, code, status = null) {
  const err = await promise.then(
    () => assert.fail(`expected GeminiError ${code}`),
    (e) => e,
  );
  assert.ok(err instanceof GeminiError, `expected a GeminiError, got ${err?.name}`);
  assert.equal(err.code, code);
  assert.equal(err.status, status);
  assertNoSecrets(err);
  assertStayedLocal();
  return err;
}

describe('generateStructuredReply — valid output', () => {
  test('returns exactly the four fields, trimmed; extra fields dropped; thought parts ignored', async () => {
    fakeGemini(() =>
      candidateWith([
        { text: 'internal reasoning that is not JSON', thought: true },
        { text: JSON.stringify({ ...VALID, confidence: 0.9, extra: 'dropped' }) },
      ]));

    const result = await generateStructuredReply(REQUEST);

    assert.deepEqual(result, {
      reply: 'Great, 150 members! Would a free 7-day demo help?',
      suggestedStage: 'INTERESTED',
      reason: 'Shared the gym size',
      requiresHuman: false,
    });
    assertStayedLocal();
  });

  test('suggestedStage null, an empty reason, and every one of the six stages are accepted', async () => {
    const first = fakeGemini(answerJson({ ...VALID, suggestedStage: null, reason: '' }));
    assert.deepEqual(await generateStructuredReply(REQUEST), {
      reply: 'Great, 150 members! Would a free 7-day demo help?',
      suggestedStage: null,
      reason: '',
      requiresHuman: false,
    });
    first.mock.restore();

    for (const stage of ['NEW', 'CONTACTED', 'INTERESTED', 'QUALIFIED', 'CONVERTED', 'LOST']) {
      const fetchMock = fakeGemini(answerJson({ ...VALID, suggestedStage: stage, requiresHuman: true }));
      const result = await generateStructuredReply(REQUEST);
      assert.equal(result.suggestedStage, stage);
      assert.equal(result.requiresHuman, true);
      fetchMock.mock.restore();
    }
  });

  test('sends one POST to the gemini-3.5-flash generateContent route with the key in a header and the schema', async () => {
    fakeGemini(answerJson(VALID));
    await generateStructuredReply(REQUEST);

    assert.equal(calls.length, 1);
    const [{ url, init }] = calls;
    assert.equal(url, GENERATE_URL);
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), KEY);
    assert.ok(!url.includes(KEY), 'the key must not be in the URL');

    const body = JSON.parse(init.body);
    assert.ok(JSON.stringify(body.systemInstruction).includes(SYSTEM));
    assert.deepEqual(
      body.contents.map((c) => ({ role: c.role, text: c.parts.map((p) => p.text).join('') })),
      REQUEST.messages,
    );
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    const schema = body.generationConfig.responseSchema;
    assert.deepEqual(Object.keys(schema.properties).sort(), ['reason', 'reply', 'requiresHuman', 'suggestedStage']);
    assert.deepEqual(schema.properties.suggestedStage.enum, ['NEW', 'CONTACTED', 'INTERESTED', 'QUALIFIED', 'CONVERTED', 'LOST']);
    assert.deepEqual([...schema.required].sort(), ['reason', 'reply', 'requiresHuman', 'suggestedStage']);
    assertStayedLocal();
  });
});

describe('generateStructuredReply — invalid output is INVALID_RESPONSE', () => {
  const cases = {
    'not JSON': answerText('Sure! Here is my reply.'),
    'empty text': answerText(''),
    'a JSON array': answerJson([VALID]),
    'JSON null': answerJson(null),
    'reply empty': answerJson({ ...VALID, reply: '' }),
    'reply only whitespace': answerJson({ ...VALID, reply: '   ' }),
    'reply over 4096 characters': answerJson({ ...VALID, reply: 'x'.repeat(4097) }),
    'reply not a string': answerJson({ ...VALID, reply: 42 }),
    'stage not a known stage': answerJson({ ...VALID, suggestedStage: 'WON' }),
    'stage in lowercase': answerJson({ ...VALID, suggestedStage: 'new' }),
    'stage a number': answerJson({ ...VALID, suggestedStage: 3 }),
    'reason not a string': answerJson({ ...VALID, reason: null }),
    'requiresHuman as the string "true"': answerJson({ ...VALID, requiresHuman: 'true' }),
    'reply missing': answerJson({ suggestedStage: null, reason: '', requiresHuman: false }),
    'suggestedStage missing': answerJson({ reply: 'Hi', reason: '', requiresHuman: false }),
    'reason missing': answerJson({ reply: 'Hi', suggestedStage: null, requiresHuman: false }),
    'requiresHuman missing': answerJson({ reply: 'Hi', suggestedStage: null, reason: '' }),
    'no candidates (blocked)': () => json(200, { promptFeedback: { blockReason: 'SAFETY' } }),
    'a candidate without parts': () => json(200, { candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }] }),
    'only thought parts': () => candidateWith([{ text: JSON.stringify(VALID), thought: true }]),
  };

  for (const [label, answer] of Object.entries(cases)) {
    test(label, async () => {
      fakeGemini(answer);
      await expectGeminiError(generateStructuredReply(REQUEST), 'INVALID_RESPONSE');
      assert.equal(calls.length, 1);
    });
  }

  test('a reply of exactly 4096 characters is still valid', async () => {
    fakeGemini(answerJson({ ...VALID, reply: 'x'.repeat(4096) }));
    assert.equal((await generateStructuredReply(REQUEST)).reply.length, 4096);
  });
});

describe('generateStructuredReply — errors', () => {
  test('HTTP 429 is QUOTA, with a RESOURCE_EXHAUSTED body or a plain-text body', async () => {
    let fetchMock = fakeGemini(() =>
      json(429, { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } }));
    await expectGeminiError(generateStructuredReply(REQUEST), 'QUOTA', 429);
    fetchMock.mock.restore();

    fetchMock = fakeGemini(() => new Response('Too Many Requests', { status: 429, headers: { 'Content-Type': 'text/plain' } }));
    await expectGeminiError(generateStructuredReply(REQUEST), 'QUOTA', 429);
  });

  test('other 4xx and 5xx are API_ERROR with their status, never QUOTA (503 "overloaded" included)', async () => {
    const answers = [
      [400, 'INVALID_ARGUMENT', 'Request contains an invalid argument.'],
      [401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.'],
      [403, 'PERMISSION_DENIED', 'The caller does not have permission.'],
      [404, 'NOT_FOUND', 'models/gemini-3.5-flash is not found.'],
      [500, 'INTERNAL', 'An internal error has occurred.'],
      [503, 'UNAVAILABLE', 'The model is overloaded. Please try again later.'],
    ];
    for (const [status, word, message] of answers) {
      const fetchMock = fakeGemini(() => json(status, { error: { code: status, message, status: word } }));
      await expectGeminiError(generateStructuredReply(REQUEST), 'API_ERROR', status);
      fetchMock.mock.restore();
    }
  });

  test('no retry: a 429 and a 503 each make exactly one request', async () => {
    for (const status of [429, 503]) {
      const fetchMock = fakeGemini(() => json(status, { error: { code: status, message: 'x', status: 'X' } }));
      await generateStructuredReply(REQUEST).catch(() => {});
      assert.equal(calls.length, 1, `status ${status}`);
      fetchMock.mock.restore();
    }
  });

  test('a request still open after 20 s is TIMEOUT (mocked timers, no real waiting)', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    fakeGemini((init) => new Promise((_resolve, reject) => {
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
    await expectGeminiError(pending, 'TIMEOUT');
  });

  test('a missing key is NOT_CONFIGURED, and Gemini is never called', async () => {
    fakeGemini(() => {
      throw new Error('Gemini must not be called');
    });
    mock.property(env, 'geminiApiKey', '');
    await expectGeminiError(generateStructuredReply(REQUEST), 'NOT_CONFIGURED');
    assert.equal(calls.length, 0);
  });

  test('a connection that was never made is UNREACHABLE; one that broke after connecting is API_ERROR', async () => {
    let fetchMock = fakeGemini(() => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) });
    });
    await expectGeminiError(generateStructuredReply(REQUEST), 'UNREACHABLE');
    fetchMock.mock.restore();

    fetchMock = fakeGemini(() => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    });
    await expectGeminiError(generateStructuredReply(REQUEST), 'UNREACHABLE');
    fetchMock.mock.restore();

    fakeGemini(() => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
    });
    await expectGeminiError(generateStructuredReply(REQUEST), 'API_ERROR');
  });

  test("the SDK's own environment variables cannot redirect it (process.env restored exactly)", async () => {
    const overrides = {
      GOOGLE_GEMINI_BASE_URL: 'https://redirected.example',
      GOOGLE_VERTEX_BASE_URL: 'https://redirected-vertex.example',
      GOOGLE_GENAI_USE_VERTEXAI: 'true',
      GOOGLE_GENAI_USE_ENTERPRISE: 'true',
      GOOGLE_CLOUD_PROJECT: 'some-project',
      GOOGLE_CLOUD_LOCATION: 'us-central1',
    };
    const before = { ...process.env };
    try {
      Object.assign(process.env, overrides);
      fakeGemini(answerJson(VALID));
      await generateStructuredReply(REQUEST);

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, GENERATE_URL);
      assert.equal(new Headers(calls[0].init.headers).get('x-goog-api-key'), KEY);
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
    fakeGemini(() => {
      throw new Error('Gemini must not be called');
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
      assert.ok(err instanceof TypeError && !(err instanceof GeminiError));
      assert.ok(!err.message.includes(LEAD_TEXT) && !err.message.includes(SYSTEM));
    }
    assert.equal(calls.length, 0);
  });
});

test('no console output at all from any case in this file', () => {
  assert.deepEqual(allConsoleOutput, []);
});
