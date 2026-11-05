const { test, describe, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const campaignRepository = require('../../src/infrastructure/database/campaign.repository');
const conversationRepository = require('../../src/infrastructure/database/conversation.repository');
const leadRepository = require('../../src/infrastructure/database/lead.repository');
const createMessageUseCase = require('../../src/application/useCases/createMessage.useCase');
const { OpenWAError } = require('../../src/infrastructure/whatsapp/openwa.client');

const USE_CASE = '../../src/application/useCases/sendBatch.useCase';
const START = Date.UTC(2026, 10, 6, 9, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const DELAY_MS = 7000; // BATCH_DELAY_SECONDS=7 in test.env (cap 5, max failures in a row 2)
const LIMIT = 'First-contact limit for the last 24 hours reached';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const badRequest = () => new OpenWAError('OpenWA error 400: Session is not active', { status: 400 });

// A fresh copy of the use case, so each test starts with no running batch and no earlier send attempt.
function loadSendBatch() {
  delete require.cache[require.resolve(USE_CASE)];
  return require(USE_CASE).sendBatch;
}

// In-memory campaign 3 with NEW leads 41, 42, ... Records every send attempt with the mocked time.
// `outcomes` is consumed one per attempt: undefined = sent, an Error = that send fails.
function useWorld({ leadCount = 3, recent = 0, outcomes = [] } = {}) {
  const world = {
    campaign: { id: 3, status: 'ACTIVE' },
    leads: new Map(),
    conversations: new Map(), // leadId -> conversation
    recent, // campaign conversations created in the last 24 hours
    attempts: [],
    nextConversationId: 100,
  };
  for (let i = 0; i < leadCount; i++) {
    const id = 41 + i;
    world.leads.set(id, { id, name: `Lead Name ${id}`, phoneNumber: `+92300123456${i}`, stage: 'NEW', campaignId: 3 });
  }
  const queue = [...outcomes];
  const mocks = {
    findCampaignById: mock.method(campaignRepository, 'findCampaignById', async () => ({ ...world.campaign })),
    findLeadsForBatch: mock.method(campaignRepository, 'findLeadsForBatch', async (_campaignId, take) =>
      [...world.leads.values()].filter((l) => l.stage === 'NEW' && !world.conversations.has(l.id)).slice(0, take)),
    findLeadById: mock.method(leadRepository, 'findLeadById', async (id) =>
      (world.leads.has(id) ? { ...world.leads.get(id) } : null)),
    findConversationByLeadId: mock.method(conversationRepository, 'findConversationByLeadId', async (leadId) =>
      world.conversations.get(leadId) ?? null),
    countRecent: mock.method(conversationRepository, 'countRecentCampaignConversations', async () => world.recent),
    createConversation: mock.method(conversationRepository, 'createConversation', async (leadId) => {
      const conversation = { id: world.nextConversationId++, leadId };
      world.conversations.set(leadId, conversation);
      world.recent++;
      return conversation;
    }),
    deleteIfEmpty: mock.method(conversationRepository, 'deleteConversationIfEmpty', async (id) => {
      for (const [leadId, conversation] of world.conversations) {
        if (conversation.id === id) {
          world.conversations.delete(leadId);
          world.recent--;
          return 1;
        }
      }
      return 0;
    }),
    createMessage: mock.method(createMessageUseCase, 'createMessage', async (conversationId) => {
      const { leadId } = [...world.conversations.values()].find((c) => c.id === conversationId);
      world.attempts.push({ leadId, at: Date.now() });
      const outcome = queue.shift();
      if (outcome) throw outcome;
      world.leads.get(leadId).stage = 'CONTACTED';
      return { id: 900 + world.attempts.length };
    }),
  };
  return { world, mocks };
}

// Lets the background batch run to the end, ticking the mocked clock through every delay.
async function finish(done) {
  let settled = false;
  done.then(() => {
    settled = true;
  });
  for (let i = 0; i < 100 && !settled; i++) {
    await flush();
    if (!settled) mock.timers.tick(DELAY_MS);
  }
  await flush();
  assert.ok(settled, 'the batch did not finish');
  return done;
}

let logs;
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START });
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    mock.method(console, level, (...args) => logs.push(args.join(' ')));
  }
});
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

describe('sendBatch — starting', () => {
  test('returns at once with queued and remaining, and sends the first lead without waiting', async () => {
    const { world } = useWorld({ leadCount: 3 });
    const sendBatch = loadSendBatch();

    const { done, ...result } = await sendBatch(3, 10);
    assert.deepEqual(result, { campaignId: 3, queued: 3, remaining: 5 });
    await flush();
    assert.deepEqual(world.attempts, [{ leadId: 41, at: START }]);
    await finish(done);
  });

  test('waits exactly BATCH_DELAY_SECONDS between real send attempts', async () => {
    const { world } = useWorld({ leadCount: 3 });
    const { done } = await loadSendBatch()(3, 3);
    await flush();
    mock.timers.tick(DELAY_MS - 1);
    await flush();
    assert.equal(world.attempts.length, 1);
    mock.timers.tick(1);
    await flush();
    assert.deepEqual(world.attempts[1], { leadId: 42, at: START + DELAY_MS });
    await finish(done);
  });

  test('only one batch runs at a time (even two requests at once); another can start after it ends', async () => {
    const { world } = useWorld({ leadCount: 2 });
    const sendBatch = loadSendBatch();

    const first = sendBatch(3, 2);
    await assert.rejects(sendBatch(3, 2), { message: 'A batch is already running' });
    const { done } = await first;
    await assert.rejects(sendBatch(3, 2), { message: 'A batch is already running' });
    await finish(done);

    world.leads.set(50, { id: 50, name: 'Lead Name 50', phoneNumber: '+923001234569', stage: 'NEW', campaignId: 3 });
    const again = await sendBatch(3, 1);
    assert.equal(again.queued, 1);
    await finish(again.done);
  });

  test('queued is limited by the allowance counted over a rolling 24 hours', async () => {
    const { mocks } = useWorld({ leadCount: 4, recent: 3 });
    const { done, ...result } = await loadSendBatch()(3, 10);

    assert.deepEqual(result, { campaignId: 3, queued: 2, remaining: 2 });
    assert.deepEqual(mocks.findLeadsForBatch.mock.calls[0].arguments, [3, 2]);
    assert.equal(mocks.countRecent.mock.calls[0].arguments[0].getTime(), START - DAY_MS);
    await finish(done);
  });

  test('with the allowance used up the request is rejected, nothing is sent and the lock is free', async () => {
    const { world, mocks } = useWorld({ leadCount: 2, recent: 5 });
    const sendBatch = loadSendBatch();

    await assert.rejects(sendBatch(3, 2), { message: LIMIT });
    assert.equal(mocks.createMessage.mock.callCount(), 0);
    world.recent = 0;
    const { queued, done } = await sendBatch(3, 2);
    assert.equal(queued, 2);
    await finish(done);
  });

  test('invalid requests are rejected without holding the lock', async () => {
    const { world, mocks } = useWorld({ leadCount: 1 });
    const sendBatch = loadSendBatch();

    for (const count of [0, -1, 1.5, NaN]) {
      await assert.rejects(sendBatch(3, count), { message: 'count must be a positive whole number' });
    }
    mocks.findCampaignById.mock.mockImplementationOnce(async () => null);
    await assert.rejects(sendBatch(3, 1), { message: 'Campaign not found' });
    world.campaign.status = 'PAUSED';
    await assert.rejects(sendBatch(3, 1), { message: 'Campaign is paused. Activate it before sending.' });

    world.campaign.status = 'ACTIVE';
    const { queued, done } = await sendBatch(3, 1);
    assert.equal(queued, 1);
    await finish(done);
  });

  test('no eligible leads: queued 0 and nothing starts', async () => {
    const { mocks } = useWorld({ leadCount: 0 });
    const sendBatch = loadSendBatch();

    const { done, ...result } = await sendBatch(3, 5);
    assert.deepEqual(result, { campaignId: 3, queued: 0, remaining: 5 });
    assert.equal(await done, null);
    assert.equal(mocks.createMessage.mock.callCount(), 0);
    assert.equal((await sendBatch(3, 5)).queued, 0);
  });
});

describe('sendBatch — checks before every send', () => {
  test('the 24-hour allowance is re-checked before each send', async () => {
    const { world } = useWorld({ leadCount: 3, recent: 2 });
    const { queued, done } = await loadSendBatch()(3, 3);
    assert.equal(queued, 3);
    await flush();
    world.recent = 5; // inbound messages from campaign leads used up the allowance meanwhile
    await finish(done);

    assert.equal(world.attempts.length, 1);
    assert.ok(logs.includes('Batch finished for campaign 3: sent 1, failed 0, unknown 0, skipped 0, stopped: 24-hour cap reached'));
  });

  test('pausing the campaign stops the batch before the next send', async () => {
    const { world } = useWorld({ leadCount: 3 });
    const { done } = await loadSendBatch()(3, 3);
    await flush();
    world.campaign.status = 'PAUSED';
    await finish(done);

    assert.equal(world.attempts.length, 1);
    assert.ok(logs.includes('Batch finished for campaign 3: sent 1, failed 0, unknown 0, skipped 0, stopped: campaign paused'));
  });

  test('leads that are no longer eligible are skipped, and skipping does not wait', async () => {
    const { world, mocks } = useWorld({ leadCount: 4 });
    world.leads.get(41).stage = 'CONTACTED';
    mocks.findLeadsForBatch.mock.mockImplementationOnce(async () => [...world.leads.values()]); // a stale queue
    const { done } = await loadSendBatch()(3, 4);
    await flush();
    assert.deepEqual(world.attempts, [{ leadId: 42, at: START }]); // 41 skipped, 42 sent at once

    world.conversations.set(43, { id: 999, leadId: 43 }); // 43 wrote to us during the wait
    world.leads.delete(44); // 44 was deleted
    await finish(done);

    assert.equal(world.attempts.length, 1);
    assert.ok(logs.includes('Batch finished for campaign 3: sent 1, failed 0, unknown 0, skipped 3'));
  });
});

describe('sendBatch — failed sends', () => {
  test('a definite failure (4xx) removes the empty conversation and the batch continues', async () => {
    const { world, mocks } = useWorld({ leadCount: 2, outcomes: [badRequest()] });
    const { done } = await loadSendBatch()(3, 2);
    await finish(done);

    assert.deepEqual(world.attempts.map((a) => a.leadId), [41, 42]);
    assert.deepEqual(mocks.deleteIfEmpty.mock.calls[0].arguments, [100]);
    assert.equal(world.conversations.has(41), false);
    assert.equal(world.leads.get(41).stage, 'NEW');
    assert.ok(logs.includes('Batch campaign 3: lead 41 failed (400)'));
  });

  test('UNREACHABLE that never connected counts as not sent', async () => {
    const neverConnected = new OpenWAError('OpenWA is unreachable', { code: 'UNREACHABLE', neverConnected: true });
    const { world, mocks } = useWorld({ leadCount: 1, outcomes: [neverConnected] });
    await finish((await loadSendBatch()(3, 1)).done);

    assert.equal(mocks.deleteIfEmpty.mock.callCount(), 1);
    assert.equal(world.conversations.has(41), false);
    assert.ok(logs.includes('Batch campaign 3: lead 41 failed (UNREACHABLE)'));
  });

  const unknownOutcomes = {
    TIMEOUT: () => new OpenWAError('OpenWA did not answer within 20000 ms', { code: 'TIMEOUT' }),
    '500': () => new OpenWAError('OpenWA error 500: engine error', { status: 500 }),
    '503': () => new OpenWAError('OpenWA error 503: rate limited', { status: 503 }),
    'UNREACHABLE after connecting': () => new OpenWAError('OpenWA is unreachable', { code: 'UNREACHABLE' }),
    'a database error after the send': () => Object.assign(new Error('Database write failed'), { code: 'P1001' }),
  };
  for (const [label, makeError] of Object.entries(unknownOutcomes)) {
    test(`${label} is an unknown outcome: conversation kept, no retry, manual check logged`, async () => {
      const { world, mocks } = useWorld({ leadCount: 1, outcomes: [makeError()] });
      await finish((await loadSendBatch()(3, 1)).done);

      assert.equal(mocks.createMessage.mock.callCount(), 1);
      assert.equal(mocks.deleteIfEmpty.mock.callCount(), 0);
      assert.equal(world.conversations.has(41), true);
      assert.ok(logs.includes('Batch campaign 3: lead 41 outcome unknown, check chat manually'));
    });
  }

  test('two failures in a row stop the batch; a success in between resets the count', async () => {
    const { world } = useWorld({ leadCount: 5, outcomes: [badRequest(), undefined, badRequest(), badRequest()] });
    await finish((await loadSendBatch()(3, 5)).done);

    assert.deepEqual(world.attempts.map((a) => a.leadId), [41, 42, 43, 44]);
    assert.ok(logs.includes('Batch finished for campaign 3: sent 1, failed 3, unknown 0, skipped 0, stopped: 2 failures in a row'));
  });

  test('SEND_PACING_LIMITED stops the batch at once', async () => {
    const pacing = new OpenWAError('OpenWA error 429: Daily allowance reached', {
      status: 429,
      code: 'SEND_PACING_LIMITED',
      retryAfterSeconds: 3600,
    });
    const { world, mocks } = useWorld({ leadCount: 3, outcomes: [pacing] });
    await finish((await loadSendBatch()(3, 3)).done);

    assert.equal(world.attempts.length, 1);
    assert.equal(mocks.deleteIfEmpty.mock.callCount(), 1);
    assert.ok(logs.includes('Batch finished for campaign 3: sent 0, failed 1, unknown 0, skipped 0, stopped: OpenWA SEND_PACING_LIMITED'));
  });

  test('NOT_CONFIGURED stops the batch at once', async () => {
    const notConfigured = new OpenWAError('OpenWA is not configured', { code: 'NOT_CONFIGURED' });
    const { world, mocks } = useWorld({ leadCount: 3, outcomes: [notConfigured] });
    await finish((await loadSendBatch()(3, 3)).done);

    assert.equal(world.attempts.length, 1);
    assert.equal(mocks.deleteIfEmpty.mock.callCount(), 1);
    assert.ok(logs.includes('Batch finished for campaign 3: sent 0, failed 1, unknown 0, skipped 0, stopped: OpenWA NOT_CONFIGURED'));
  });

  test('an unexpected error ends the batch, releases the lock and does not escape', async () => {
    const { world, mocks } = useWorld({ leadCount: 3 });
    const sendBatch = loadSendBatch();
    const { done } = await sendBatch(3, 3);
    await flush();
    mocks.findLeadById.mock.mockImplementation(async () => {
      throw Object.assign(new Error("Can't reach database server"), { code: 'P1001' });
    });

    assert.equal(await finish(done), null);
    assert.equal(world.attempts.length, 1);
    assert.ok(logs.includes('Batch for campaign 3 stopped by an unexpected error (P1001)'));
    const next = await sendBatch(3, 3);
    assert.equal(next.queued, 2);
    await finish(next.done);
  });
});

describe('sendBatch — spacing across batches', () => {
  test('a batch started right after the previous one waits the rest of the delay before its first send', async () => {
    const { world } = useWorld({ leadCount: 2 });
    const sendBatch = loadSendBatch();
    await finish((await sendBatch(3, 1)).done); // lead 41 at START

    mock.timers.tick(3000);
    const { done } = await sendBatch(3, 1);
    await flush();
    mock.timers.tick(DELAY_MS - 3000 - 1);
    await flush();
    assert.equal(world.attempts.length, 1);
    mock.timers.tick(1);
    await flush();
    assert.deepEqual(world.attempts[1], { leadId: 42, at: START + DELAY_MS });
    await finish(done);
  });

  test('a batch started after the full delay sends at once', async () => {
    const { world } = useWorld({ leadCount: 2 });
    const sendBatch = loadSendBatch();
    await finish((await sendBatch(3, 1)).done);

    mock.timers.tick(DELAY_MS);
    const { done } = await sendBatch(3, 1);
    await flush();
    assert.deepEqual(world.attempts[1], { leadId: 42, at: START + DELAY_MS });
    await finish(done);
  });
});

describe('sendBatch — logging', () => {
  test('log lines hold only ids, counts and error codes', async () => {
    const timeout = new OpenWAError('OpenWA did not answer within 20000 ms', { code: 'TIMEOUT' });
    const { world, mocks } = useWorld({ leadCount: 4, outcomes: [badRequest(), undefined, timeout] });
    world.leads.get(44).stage = 'CONTACTED';
    mocks.findLeadsForBatch.mock.mockImplementationOnce(async () => [...world.leads.values()]);
    await finish((await loadSendBatch()(3, 4)).done);

    assert.deepEqual(logs, [
      'Batch started for campaign 3: 4 queued',
      'Batch campaign 3: lead 41 failed (400)',
      'Batch campaign 3: lead 42 sent',
      'Batch campaign 3: lead 43 outcome unknown, check chat manually',
      'Batch campaign 3: lead 44 skipped (no longer eligible)',
      'Batch finished for campaign 3: sent 1, failed 1, unknown 1, skipped 1',
    ]);
    const output = logs.join('\n');
    for (const secret of ['92300123456', 'Lead Name', 'Thanks for your interest']) {
      assert.ok(!output.includes(secret), `log output contains "${secret}"`);
    }
  });
});
