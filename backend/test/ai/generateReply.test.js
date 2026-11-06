const { test, describe, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const geminiClient = require('../../src/infrastructure/ai/gemini.client');
const groqClient = require('../../src/infrastructure/ai/groq.client');
const { STAGES } = require('../../src/infrastructure/ai/replyValidation');
const { generateReply, FALLBACK_REPLY } = require('../../src/application/ai/generateReply');

const { GeminiError } = geminiClient;
const { GroqError } = groqClient;

const APPROVED_FALLBACK_REPLY =
  'Thank you for your message. Our team will get back to you shortly.\n' +
  'Aapke message ka shukriya. Hamari team jald hi aap se rabta karegi.';
const RESULT_KEYS = ['reply', 'suggestedStage', 'reason', 'requiresHuman', 'provider', 'errorCode'];

// Fake data only.
const LEAD_TEXT = 'Salam, mera gym Karachi mein hai, lead marker 6643';
const SYSTEM_TEXT = 'You are Ayesha. System marker 8812.';
const REQUEST = { systemInstruction: SYSTEM_TEXT, messages: [{ role: 'user', text: LEAD_TEXT }] };
const PROVIDER_REPLY = {
  reply: 'Great! How many members does your gym have?',
  suggestedStage: 'INTERESTED',
  reason: 'Asked about the software',
  requiresHuman: false,
};
const fallback = (errorCode) => ({
  reply: APPROVED_FALLBACK_REPLY,
  suggestedStage: null,
  reason: 'AI unavailable',
  requiresHuman: true,
  provider: 'fallback',
  errorCode,
});

// What a mocked client does: answer with a copy of a value, or throw.
const answer = (value) => async () => structuredClone(value);
const fail = (thrown) => async () => {
  throw thrown;
};
const refuse = (name) => async () => {
  throw new Error(`${name} must not be called`);
};

const QUOTA_ERROR = new GeminiError('QUOTA', 'Gemini quota exhausted', { status: 429 });

// Gemini's other codes, as [error, errorCode, log text]. Groq is never tried after these.
const GEMINI_ERRORS = [
  [new GeminiError('TIMEOUT', 'Gemini did not answer within 20000 ms'), 'TIMEOUT', 'timeout'],
  [new GeminiError('API_ERROR', 'Gemini API error 503', { status: 503 }), 'API_ERROR', 'api_error 503'],
  [new GeminiError('API_ERROR', 'Gemini request failed'), 'API_ERROR', 'api_error'],
  [new GeminiError('INVALID_RESPONSE', 'Gemini returned an invalid reply'), 'INVALID_RESPONSE', 'invalid_response'],
  [new GeminiError('UNREACHABLE', 'Gemini is unreachable'), 'UNREACHABLE', 'unreachable'],
  [new GeminiError('NOT_CONFIGURED', 'Gemini is not configured (GEMINI_API_KEY)'), 'NOT_CONFIGURED', 'not_configured'],
];
// Every Groq code after Gemini's QUOTA, as [error, errorCode, log text].
const GROQ_ERRORS = [
  [new GroqError('QUOTA', 'Groq quota exhausted', { status: 429 }), 'QUOTA', 'quota'],
  [new GroqError('TIMEOUT', 'Groq did not answer within 20000 ms'), 'TIMEOUT', 'timeout'],
  [new GroqError('NOT_CONFIGURED', 'Groq is not configured (GROQ_API_KEY)'), 'NOT_CONFIGURED', 'not_configured'],
  [new GroqError('INVALID_RESPONSE', 'Groq returned an invalid reply'), 'INVALID_RESPONSE', 'invalid_response'],
  [new GroqError('UNREACHABLE', 'Groq is unreachable'), 'UNREACHABLE', 'unreachable'],
  [new GroqError('API_ERROR', 'Groq API error 503', { status: 503 }), 'API_ERROR', 'api_error 503'],
  [new GroqError('API_ERROR', 'Groq request failed'), 'API_ERROR', 'api_error'],
];
const BAD_REQUEST_ERROR = new TypeError('generateStructuredReply needs a non-empty systemInstruction and messages');
// Neither the client's own error class nor a TypeError.
const UNEXPECTED_FROM_GEMINI = [
  new Error('something broke'),
  new GroqError('QUOTA', 'Groq quota exhausted', { status: 429 }), // the other client's class
  { code: 'QUOTA' }, // looks like a quota error, but is not a GeminiError
  undefined,
];
const UNEXPECTED_FROM_GROQ = [
  new Error('something broke'),
  new GeminiError('QUOTA', 'Gemini quota exhausted', { status: 429 }), // the other client's class
  { code: 'TIMEOUT' },
  undefined,
];

// Every way generateReply ends in the fallback, with the expected errorCode and its one log line.
const FALLBACK_SCENARIOS = [
  ...GEMINI_ERRORS.map(([error, errorCode, text]) => ({
    gemini: fail(error),
    errorCode,
    line: `AI reply: gemini ${text}, used fallback`,
  })),
  { gemini: fail(BAD_REQUEST_ERROR), errorCode: 'BAD_REQUEST', line: 'AI reply: gemini bad_request, used fallback' },
  ...UNEXPECTED_FROM_GEMINI.map((thrown) => ({
    gemini: fail(thrown),
    errorCode: 'UNEXPECTED',
    line: 'AI reply: gemini unexpected, used fallback',
  })),
  ...GROQ_ERRORS.map(([error, errorCode, text]) => ({
    gemini: fail(QUOTA_ERROR),
    groq: fail(error),
    errorCode,
    line: `AI reply: gemini quota, groq ${text}, used fallback`,
  })),
  {
    gemini: fail(QUOTA_ERROR),
    groq: fail(BAD_REQUEST_ERROR),
    errorCode: 'BAD_REQUEST',
    line: 'AI reply: gemini quota, groq bad_request, used fallback',
  },
  ...UNEXPECTED_FROM_GROQ.map((thrown) => ({
    gemini: fail(QUOTA_ERROR),
    groq: fail(thrown),
    errorCode: 'UNEXPECTED',
    line: 'AI reply: gemini quota, groq unexpected, used fallback',
  })),
];

let logs; // every console call in the current test, as [method, text]
let fetchSpy;

beforeEach(() => {
  logs = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    mock.method(console, method, (...args) => logs.push([method, args.join(' ')]));
  }
  // Both clients are mocked, so nothing may reach the network.
  fetchSpy = mock.method(globalThis, 'fetch', async () => {
    throw new Error('generateReply tests must not use the network');
  });
});
afterEach(() => {
  mock.restoreAll();
});

// One generateReply call with both clients mocked; Groq refuses unless the scenario gives it an outcome.
// Returns the result, the arguments of each client call, and the console lines of this call only.
async function run({ gemini, groq = refuse('Groq'), currentStage = 'CONTACTED' }) {
  const geminiMock = mock.method(geminiClient, 'generateStructuredReply', gemini);
  const groqMock = mock.method(groqClient, 'generateStructuredReply', groq);
  const firstLine = logs.length;
  try {
    const result = await generateReply({ request: REQUEST, currentStage });
    return {
      result,
      geminiCalls: geminiMock.mock.calls.map((call) => call.arguments),
      groqCalls: groqMock.mock.calls.map((call) => call.arguments),
      lines: logs.slice(firstLine),
    };
  } finally {
    geminiMock.mock.restore();
    groqMock.mock.restore();
  }
}

describe('generateReply — a provider answers', () => {
  test('Gemini answers: its four fields plus provider "gemini" and errorCode null; Groq is never called; nothing is logged', async () => {
    const { result, geminiCalls, groqCalls, lines } = await run({
      gemini: answer({ ...PROVIDER_REPLY, confidence: 0.9 }),
    });

    assert.deepEqual(result, { ...PROVIDER_REPLY, provider: 'gemini', errorCode: null });
    assert.deepEqual(Object.keys(result), RESULT_KEYS);
    assert.equal(geminiCalls.length, 1);
    assert.equal(geminiCalls[0].length, 1);
    assert.equal(geminiCalls[0][0], REQUEST, 'the request is passed on unchanged, as the same object');
    assert.equal(groqCalls.length, 0);
    assert.deepEqual(lines, []);
  });

  test('a CONVERTED suggestion becomes null whatever the current stage; reply, reason and requiresHuman are unchanged', async () => {
    const converted = {
      reply: 'Great, a team member will confirm your plan.',
      suggestedStage: 'CONVERTED',
      reason: 'The lead says they want to buy',
      requiresHuman: true,
    };
    for (const currentStage of STAGES) {
      const { result } = await run({ gemini: answer(converted), currentStage });
      assert.deepEqual(result, { ...converted, suggestedStage: null, provider: 'gemini', errorCode: null }, currentStage);
    }
  });

  test('a suggestion equal to the current stage becomes null; every other stage and null pass through', async () => {
    for (const currentStage of STAGES) {
      for (const suggestedStage of [...STAGES, null]) {
        const { result } = await run({ gemini: answer({ ...PROVIDER_REPLY, suggestedStage }), currentStage });
        const expected = suggestedStage === 'CONVERTED' || suggestedStage === currentStage ? null : suggestedStage;
        assert.equal(result.suggestedStage, expected, `${suggestedStage} at ${currentStage}`);
        assert.equal(result.reason, PROVIDER_REPLY.reason, 'the reason is kept');
      }
    }
  });

  test('Gemini QUOTA, then Groq answers: provider "groq", errorCode null, one warn line, the same stage rules', async () => {
    const { result, geminiCalls, groqCalls, lines } = await run({
      gemini: fail(QUOTA_ERROR),
      groq: answer(PROVIDER_REPLY),
    });
    assert.deepEqual(result, { ...PROVIDER_REPLY, provider: 'groq', errorCode: null });
    assert.deepEqual(Object.keys(result), RESULT_KEYS);
    assert.equal(geminiCalls.length, 1);
    assert.equal(groqCalls.length, 1);
    assert.equal(groqCalls[0][0], REQUEST, 'Groq gets the same request');
    assert.deepEqual(lines, [['warn', 'AI reply: gemini quota, used groq']]);

    const converted = await run({
      gemini: fail(QUOTA_ERROR),
      groq: answer({ ...PROVIDER_REPLY, suggestedStage: 'CONVERTED' }),
      currentStage: 'QUALIFIED',
    });
    assert.equal(converted.result.suggestedStage, null);
    const same = await run({
      gemini: fail(QUOTA_ERROR),
      groq: answer({ ...PROVIDER_REPLY, suggestedStage: 'QUALIFIED' }),
      currentStage: 'QUALIFIED',
    });
    assert.equal(same.result.suggestedStage, null);
    assert.equal(same.result.provider, 'groq');
  });
});

describe('generateReply — failures', () => {
  test("Gemini QUOTA, then each Groq error code: the fallback with Groq's code", async () => {
    for (const [error, errorCode, text] of GROQ_ERRORS) {
      const { result, groqCalls, lines } = await run({ gemini: fail(QUOTA_ERROR), groq: fail(error) });
      assert.deepEqual(result, fallback(errorCode), text);
      assert.equal(groqCalls.length, 1);
      assert.deepEqual(lines, [['error', `AI reply: gemini quota, groq ${text}, used fallback`]]);
    }
  });

  test('every other Gemini error code: the fallback with that code, and Groq is never tried', async () => {
    for (const [error, errorCode, text] of GEMINI_ERRORS) {
      const { result, groqCalls, lines } = await run({ gemini: fail(error) });
      assert.deepEqual(result, fallback(errorCode), text);
      assert.equal(groqCalls.length, 0);
      assert.deepEqual(lines, [['error', `AI reply: gemini ${text}, used fallback`]]);
    }
  });

  test('a TypeError from either client, thrown at once or rejected, is the fallback with BAD_REQUEST', async () => {
    const throwsAtOnce = () => {
      throw BAD_REQUEST_ERROR;
    };
    for (const gemini of [fail(BAD_REQUEST_ERROR), throwsAtOnce]) {
      const { result, groqCalls, lines } = await run({ gemini });
      assert.deepEqual(result, fallback('BAD_REQUEST'));
      assert.equal(groqCalls.length, 0);
      assert.deepEqual(lines, [['error', 'AI reply: gemini bad_request, used fallback']]);
    }
    for (const groq of [fail(BAD_REQUEST_ERROR), throwsAtOnce]) {
      const { result, lines } = await run({ gemini: fail(QUOTA_ERROR), groq });
      assert.deepEqual(result, fallback('BAD_REQUEST'));
      assert.deepEqual(lines, [['error', 'AI reply: gemini quota, groq bad_request, used fallback']]);
    }
  });

  test('anything else thrown is the fallback with UNEXPECTED; only a real GeminiError QUOTA tries Groq', async () => {
    for (const thrown of UNEXPECTED_FROM_GEMINI) {
      const { result, groqCalls, lines } = await run({ gemini: fail(thrown) });
      assert.deepEqual(result, fallback('UNEXPECTED'));
      assert.equal(groqCalls.length, 0, 'only a GeminiError with code QUOTA may try Groq');
      assert.deepEqual(lines, [['error', 'AI reply: gemini unexpected, used fallback']]);
    }
    for (const thrown of UNEXPECTED_FROM_GROQ) {
      const { result, lines } = await run({ gemini: fail(QUOTA_ERROR), groq: fail(thrown) });
      assert.deepEqual(result, fallback('UNEXPECTED'));
      assert.deepEqual(lines, [['error', 'AI reply: gemini quota, groq unexpected, used fallback']]);
    }
  });

  test('every path calls Gemini exactly once and Groq at most once, only after Gemini QUOTA, and never the network', async () => {
    const scenarios = [
      { gemini: answer(PROVIDER_REPLY) },
      { gemini: fail(QUOTA_ERROR), groq: answer(PROVIDER_REPLY) },
      ...FALLBACK_SCENARIOS,
    ];
    for (const scenario of scenarios) {
      const { geminiCalls, groqCalls } = await run(scenario);
      assert.equal(geminiCalls.length, 1);
      assert.equal(groqCalls.length, scenario.groq ? 1 : 0);
    }
    assert.equal(fetchSpy.mock.callCount(), 0);
  });

  test('an invalid currentStage rejects with a TypeError before either client is called', async () => {
    const geminiMock = mock.method(geminiClient, 'generateStructuredReply', refuse('Gemini'));
    const groqMock = mock.method(groqClient, 'generateStructuredReply', refuse('Groq'));
    const calls = [
      () => generateReply(),
      () => generateReply({ request: REQUEST }),
      ...[undefined, null, '', 'contacted', 'WON', 42].map(
        (currentStage) => () => generateReply({ request: REQUEST, currentStage }),
      ),
    ];
    for (const call of calls) {
      await assert.rejects(call(), (err) => {
        assert.ok(err instanceof TypeError, `expected a TypeError, got ${err?.name}`);
        assert.equal(err.message, 'generateReply needs currentStage to be one of the six lead stages');
        return true;
      });
    }
    assert.equal(geminiMock.mock.callCount(), 0);
    assert.equal(groqMock.mock.callCount(), 0);
    assert.deepEqual(logs, []);
  });
});

describe('generateReply — fallback, logging and leaks', () => {
  test('FALLBACK_REPLY is exactly the approved two-line text, and every fallback has the same shape', async () => {
    assert.equal(
      FALLBACK_REPLY,
      'Thank you for your message. Our team will get back to you shortly.\n' +
        'Aapke message ka shukriya. Hamari team jald hi aap se rabta karegi.',
    );
    assert.deepEqual(FALLBACK_REPLY.split('\n'), [
      'Thank you for your message. Our team will get back to you shortly.',
      'Aapke message ka shukriya. Hamari team jald hi aap se rabta karegi.',
    ]);

    for (const scenario of FALLBACK_SCENARIOS) {
      const { result } = await run(scenario);
      assert.deepEqual(result, {
        reply: APPROVED_FALLBACK_REPLY,
        suggestedStage: null,
        reason: 'AI unavailable',
        requiresHuman: true,
        provider: 'fallback',
        errorCode: scenario.errorCode,
      });
      assert.deepEqual(Object.keys(result), RESULT_KEYS);
    }
  });

  test('console: nothing when Gemini answers, otherwise exactly one line with its exact text', async () => {
    assert.deepEqual((await run({ gemini: answer(PROVIDER_REPLY) })).lines, []);
    assert.deepEqual((await run({ gemini: fail(QUOTA_ERROR), groq: answer(PROVIDER_REPLY) })).lines, [
      ['warn', 'AI reply: gemini quota, used groq'],
    ]);
    for (const scenario of FALLBACK_SCENARIOS) {
      assert.deepEqual((await run(scenario)).lines, [['error', scenario.line]]);
    }
  });

  test('nothing leaks: error messages holding a key or chat text never reach a result field or the log line', async () => {
    const secrets = ['AIza-fake-key-marker-5150', 'gsk-fake-key-marker-5151', LEAD_TEXT, SYSTEM_TEXT];
    const leaky = `request failed: ${secrets.join(' | ')}`;
    const leakyQuota = new GeminiError('QUOTA', leaky, { status: 429 });
    const scenarios = [
      { gemini: fail(new GeminiError('TIMEOUT', leaky)) },
      { gemini: fail(new GeminiError('API_ERROR', leaky, { status: 500 })) },
      { gemini: fail(new TypeError(leaky)) },
      { gemini: fail(new Error(leaky)) },
      { gemini: fail(leakyQuota), groq: answer(PROVIDER_REPLY) },
      { gemini: fail(leakyQuota), groq: fail(new GroqError('API_ERROR', leaky, { status: 400 })) },
      { gemini: fail(leakyQuota), groq: fail(new TypeError(leaky)) },
      { gemini: fail(leakyQuota), groq: fail(new Error(leaky)) },
    ];
    for (const scenario of scenarios) {
      const { result, lines } = await run(scenario);
      const seen = JSON.stringify(result) + JSON.stringify(lines);
      for (const secret of secrets) assert.ok(!seen.includes(secret), `leaked: ${secret}`);
      assert.ok(!seen.includes('request failed'), 'error messages are never copied');
    }

    // When a provider answers, its text is only in reply and reason, and the request text is nowhere.
    const marked = {
      reply: 'reply marker 1201',
      suggestedStage: 'QUALIFIED',
      reason: 'reason marker 1202',
      requiresHuman: false,
    };
    for (const scenario of [{ gemini: answer(marked) }, { gemini: fail(QUOTA_ERROR), groq: answer(marked) }]) {
      const { result, lines } = await run(scenario);
      const { reply, reason, ...others } = result;
      assert.equal(reply, 'reply marker 1201');
      assert.equal(reason, 'reason marker 1202');
      assert.ok(!JSON.stringify(others).includes('marker'));
      assert.ok(!JSON.stringify(lines).includes('marker'));
      assert.ok(!JSON.stringify(result).includes(LEAD_TEXT));
      assert.ok(!JSON.stringify(result).includes(SYSTEM_TEXT));
    }
  });
});
