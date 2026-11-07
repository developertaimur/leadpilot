const { test, describe, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const env = require('../../src/config/env');
const replyToLeadUseCase = require('../../src/application/useCases/replyToLead.useCase');
const autoReply = require('../../src/application/ai/autoReply');

let logs; // [method, text] for every console call in the current test
let unhandled; // every unhandled rejection seen during the current test
let fetchSpy;
const onUnhandled = (reason) => unhandled.push(reason);

beforeEach(() => {
  logs = [];
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    mock.method(console, method, (...args) => logs.push([method, args.join(' ')]));
  }
  fetchSpy = mock.method(globalThis, 'fetch', async () => {
    throw new Error('autoReply tests must not use the network');
  });
});
afterEach(async () => {
  try {
    await autoReply.whenIdle(); // no job may outlive its test
    assert.equal(fetchSpy.mock.callCount(), 0, 'no network');
  } finally {
    process.off('unhandledRejection', onUnhandled);
    mock.restoreAll();
  }
});

const turnOn = () => mock.property(env, 'aiAutoReplyEnabled', true);
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
async function settle(turns = 5) {
  for (let i = 0; i < turns; i += 1) await nextTurn();
}
async function waitUntil(condition, label) {
  for (let i = 0; i < 100; i += 1) {
    if (condition()) return;
    await nextTurn();
  }
  assert.fail(`timed out waiting for ${label}`);
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// replyToLead mocked so each job waits at its own gate until the test opens it. Records starts, ends and
// how many jobs ran at once, per conversation and overall.
function gatedReplies() {
  const gates = new Map(); // triggerMessageId -> deferred
  const events = [];
  const running = new Map(); // conversationId -> jobs running now
  const peak = { overall: 0, perConversation: 0 };
  let total = 0;
  const reply = mock.method(replyToLeadUseCase, 'replyToLead', async (conversationId, trigger) => {
    running.set(conversationId, (running.get(conversationId) ?? 0) + 1);
    total += 1;
    peak.overall = Math.max(peak.overall, total);
    peak.perConversation = Math.max(peak.perConversation, running.get(conversationId));
    events.push(`start ${conversationId}/${trigger}`);
    const gate = deferred();
    gates.set(trigger, gate);
    try {
      return await gate.promise;
    } finally {
      events.push(`end ${conversationId}/${trigger}`);
      running.set(conversationId, running.get(conversationId) - 1);
      total -= 1;
    }
  });
  return { reply, gates, events, peak, open: (trigger, value = { status: 'replied' }) => gates.get(trigger).resolve(value) };
}

describe('autoReply.scheduleReply', () => {
  test('switch off: nothing is queued, replyToLead is never called, and nothing is logged', async () => {
    const reply = mock.method(replyToLeadUseCase, 'replyToLead', async () => ({ status: 'replied' }));
    assert.equal(env.aiAutoReplyEnabled, false, 'off by default in tests');

    assert.equal(autoReply.scheduleReply(11, 66), false);
    assert.equal(autoReply.pendingConversations(), 0);
    await settle();
    assert.equal(reply.mock.callCount(), 0);
    assert.deepEqual(logs, []);
  });

  test('switch on: one job calls replyToLead once with the ids, the entry is removed when idle, and nothing of its own is logged', async () => {
    turnOn();
    const reply = mock.method(replyToLeadUseCase, 'replyToLead', async () => ({ status: 'replied' }));

    assert.equal(autoReply.scheduleReply(11, 66), true);
    assert.equal(autoReply.pendingConversations(), 1);
    await autoReply.whenIdle();
    assert.deepEqual(reply.mock.calls.map((call) => call.arguments), [[11, 66]]);
    assert.equal(autoReply.pendingConversations(), 0);
    assert.deepEqual(logs, []);
  });

  test('same conversation: jobs run in the order queued, one at a time, each only after the previous settled', async () => {
    turnOn();
    const jobs = gatedReplies();
    for (const trigger of [66, 67, 68]) autoReply.scheduleReply(11, trigger);

    await waitUntil(() => jobs.gates.has(66), 'job 66');
    await settle();
    assert.deepEqual(jobs.events, ['start 11/66'], 'the second job waits for the first');

    jobs.open(66);
    await waitUntil(() => jobs.gates.has(67), 'job 67');
    await settle();
    assert.deepEqual(jobs.events, ['start 11/66', 'end 11/66', 'start 11/67']);

    jobs.open(67);
    await waitUntil(() => jobs.gates.has(68), 'job 68');
    jobs.open(68);
    await autoReply.whenIdle();
    assert.deepEqual(jobs.events, ['start 11/66', 'end 11/66', 'start 11/67', 'end 11/67', 'start 11/68', 'end 11/68']);
    assert.equal(jobs.peak.perConversation, 1, 'never two jobs at once for one conversation');
    assert.equal(autoReply.pendingConversations(), 0);
  });

  test('different conversations run in parallel: both jobs start before either finishes', async () => {
    turnOn();
    const jobs = gatedReplies();
    autoReply.scheduleReply(11, 66);
    autoReply.scheduleReply(12, 70);

    await waitUntil(() => jobs.gates.has(66) && jobs.gates.has(70), 'both jobs');
    assert.deepEqual([...jobs.events].sort(), ['start 11/66', 'start 12/70']);
    assert.equal(jobs.peak.overall, 2);
    assert.equal(autoReply.pendingConversations(), 2);

    jobs.open(70);
    jobs.open(66);
    await autoReply.whenIdle();
    assert.equal(autoReply.pendingConversations(), 0);
  });

  test('a job that rejects or throws at once does not block the next one, logs one code-only line, and never escapes', async () => {
    turnOn();
    const outcomes = [
      () => Promise.reject(Object.assign(new Error('leaky marker +12025550199 Fakelead'), { code: 'P1001' })),
      () => {
        throw new TypeError('leaky marker +12025550199');
      },
      () => Promise.reject(undefined),
      async () => ({ status: 'replied' }),
    ];
    let next = 0;
    const reply = mock.method(replyToLeadUseCase, 'replyToLead', () => outcomes[next++]());
    for (const trigger of [66, 67, 68, 69]) autoReply.scheduleReply(11, trigger);

    await autoReply.whenIdle();
    await settle();
    assert.deepEqual(reply.mock.calls.map((call) => call.arguments), [[11, 66], [11, 67], [11, 68], [11, 69]]);
    assert.deepEqual(logs, [
      ['error', 'AI auto-reply conversation 11: job failed (P1001)'],
      ['error', 'AI auto-reply conversation 11: job failed (TypeError)'],
      ['error', 'AI auto-reply conversation 11: job failed (UNEXPECTED)'],
    ]);
    for (const [, line] of logs) {
      for (const leak of ['marker', '12025550199', 'Fakelead', '66', '67', '68', '69']) {
        assert.ok(!line.includes(leak), `failure line holds "${leak}"`);
      }
    }

    // Even a console that throws while logging the failure cannot turn into a rejection.
    console.error.mock.mockImplementationOnce(() => {
      throw new Error('console is broken');
    });
    reply.mock.mockImplementationOnce(() => Promise.reject(new Error('fails again')));
    autoReply.scheduleReply(11, 70);
    await autoReply.whenIdle();
    await settle();

    assert.deepEqual(unhandled, []);
    assert.equal(autoReply.pendingConversations(), 0);
  });

  test('the map holds one entry per busy conversation and none once idle, also after failures and interleaved chains', async () => {
    turnOn();
    const jobs = gatedReplies();
    autoReply.scheduleReply(11, 66);
    autoReply.scheduleReply(12, 70);
    autoReply.scheduleReply(11, 67);
    assert.equal(autoReply.pendingConversations(), 2);

    await waitUntil(() => jobs.gates.has(66) && jobs.gates.has(70), 'the first jobs');
    jobs.open(66);
    await waitUntil(() => jobs.gates.has(67), 'job 67');
    assert.equal(autoReply.pendingConversations(), 2, 'conversation 11 is still busy with job 67');

    jobs.open(70);
    await waitUntil(() => autoReply.pendingConversations() === 1, 'conversation 12 to be idle');

    jobs.gates.get(67).reject(new Error('fails'));
    await autoReply.whenIdle();
    assert.equal(autoReply.pendingConversations(), 0);

    // An idle conversation starts a fresh queue.
    autoReply.scheduleReply(11, 68);
    assert.equal(autoReply.pendingConversations(), 1);
    await waitUntil(() => jobs.gates.has(68), 'job 68');
    jobs.open(68);
    await autoReply.whenIdle();
    assert.equal(autoReply.pendingConversations(), 0);
    assert.deepEqual(logs, [['error', 'AI auto-reply conversation 11: job failed (Error)']]);
  });

  test('bad ids are not scheduled: false, one code-only line each, and replyToLead is never called', async () => {
    turnOn();
    const reply = mock.method(replyToLeadUseCase, 'replyToLead', async () => ({ status: 'replied' }));
    const bad = [[0, 66], [11, 0], [-1, 66], [1.5, 66], ['11', 66], [11, '66'], [null, 66], [11, undefined], [NaN, 66], []];
    for (const [conversationId, trigger] of bad) {
      assert.equal(autoReply.scheduleReply(conversationId, trigger), false, String([conversationId, trigger]));
    }
    await settle();
    assert.equal(reply.mock.callCount(), 0);
    assert.equal(autoReply.pendingConversations(), 0);
    assert.deepEqual(logs, Array.from({ length: bad.length }, () => ['error', 'AI auto-reply: not scheduled (bad_request)']));
  });

  test('a job never starts while scheduleReply runs or in the same turn of the event loop', async () => {
    turnOn();
    const reply = mock.method(replyToLeadUseCase, 'replyToLead', async () => ({ status: 'replied' }));

    autoReply.scheduleReply(11, 66);
    assert.equal(reply.mock.callCount(), 0, 'not started synchronously');
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    assert.equal(reply.mock.callCount(), 0, 'not started by the microtasks of this turn');

    await autoReply.whenIdle();
    assert.equal(reply.mock.callCount(), 1);
  });
});
