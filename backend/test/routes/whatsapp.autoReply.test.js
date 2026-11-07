const { test, describe, before, after, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startApp } = require('../helpers/startApp');
const env = require('../../src/config/env');
const handleIncomingUseCase = require('../../src/application/useCases/handleIncomingWhatsAppMessage.useCase');
const replyToLeadUseCase = require('../../src/application/useCases/replyToLead.useCase');
const autoReply = require('../../src/application/ai/autoReply');
const { logSafeId } = require('../../src/infrastructure/whatsapp/openwa.webhook');
const whatsappRoutes = require('../../src/api/routes/whatsapp.routes');

// Fake data only. The save use case and replyToLead are mocked: no database, OpenWA or AI is reached.
const SECRET = 'test-openwa-webhook-secret';
const MESSAGE_ID = 'false_12025550199@c.us_3EB0FAKE0001';
const SAVED_TEXT = { duplicate: false, leadId: 23, conversationId: 11, messageId: 66 };
const SAVED_MEDIA = { duplicate: false, leadId: 23, conversationId: 11, messageId: 67 };
const OK = { status: 200, contentType: 'text/plain; charset=utf-8', body: 'OK' };
const sign = (raw, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

let app;
before(async () => {
  app = await startApp(whatsappRoutes);
});
after(() => app.close());

let logs; // [method, text] for every console call in the current test
let unhandled;
const onUnhandled = (reason) => unhandled.push(reason);
beforeEach(() => {
  logs = [];
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    mock.method(console, method, (...args) => logs.push([method, args.join(' ')]));
  }
});
afterEach(async () => {
  try {
    await autoReply.whenIdle(); // no background job may outlive its test
  } finally {
    process.off('unhandledRejection', onUnhandled);
    mock.restoreAll();
  }
});

const turnOn = () => mock.property(env, 'aiAutoReplyEnabled', true);
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
async function waitUntil(condition, label) {
  for (let i = 0; i < 100; i += 1) {
    if (condition()) return;
    await nextTurn();
  }
  assert.fail(`timed out waiting for ${label}`);
}
const replyArgs = (reply) => reply.mock.calls.map((call) => call.arguments);

function delivery(data = {}, event = 'message.received') {
  return {
    event,
    timestamp: '2026-11-07T10:00:00.000Z',
    sessionId: 'test-openwa-session-id',
    idempotencyKey: 'msg_test',
    deliveryId: 'dlv_test',
    data: {
      id: MESSAGE_ID,
      from: '12025550199@c.us',
      to: '923009999999@c.us',
      chatId: '12025550199@c.us',
      body: 'Text marker 7001',
      type: 'text',
      timestamp: 1730714400,
      isGroup: false,
      kind: 'individual',
      fromMe: false,
      contact: { pushName: 'Fakelead Markername' },
      ...data,
    },
  };
}

function post(payload, { raw = JSON.stringify(payload), signature = sign(raw) } = {}) {
  return fetch(`${app.baseUrl}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(signature && { 'X-OpenWA-Signature': signature }) },
    body: raw,
  });
}

const refuseSave = async () => {
  throw new Error('the save path must not be reached');
};

// Every kind of delivery: how the save ends (none = it must not be reached), today's response, and the
// ids replyToLead must get when the switch is on (none = it must not be called).
const CASES = {
  'a new text message': { request: () => post(delivery()), save: async () => SAVED_TEXT, expected: OK, trigger: [11, 66] },
  'a new media message, saved as a placeholder': {
    request: () => post(delivery({ type: 'image', body: 'Caption marker 7002' })),
    save: async () => SAVED_MEDIA,
    expected: OK,
    trigger: [11, 67],
  },
  'a duplicate delivery': { request: () => post(delivery()), save: async () => ({ duplicate: true, messageId: 66 }), expected: OK },
  'a skipped message': {
    request: () => post(delivery()),
    save: async () => ({ skipped: true, reason: 'OpenWA has no phone number for this @lid sender' }),
    expected: OK,
  },
  'a failed save': {
    request: () => post(delivery()),
    save: async () => {
      throw Object.assign(new Error('database down'), { code: 'P1001' });
    },
    expected: { status: 500, contentType: 'application/json; charset=utf-8', body: '{"error":"Failed to process message"}' },
  },
  'an own message': { request: () => post(delivery({ fromMe: true })), expected: OK },
  'a group message': { request: () => post(delivery({ isGroup: true, kind: 'group' })), expected: OK },
  'a channel message': { request: () => post(delivery({ kind: 'channel' })), expected: OK },
  'an unsupported type': { request: () => post(delivery({ type: 'location' })), expected: OK },
  'an empty text': { request: () => post(delivery({ body: '' })), expected: OK },
  'another event': { request: () => post(delivery({}, 'message.ack')), expected: OK },
  'a malformed payload': {
    request: () => post({ data: {} }),
    expected: {
      status: 400,
      contentType: 'application/json; charset=utf-8',
      body: '{"error":"Payload must be a JSON object with an event name"}',
    },
  },
  'a bad signature': { request: () => post(delivery(), { signature: sign('{}', 'wrong-secret') }), expected: { status: 401 } },
};

// Sends one delivery with the save mocked as the case says, then waits for any background job.
async function send(kase) {
  const save = mock.method(handleIncomingUseCase, 'handleIncomingWhatsAppMessage', kase.save ?? refuseSave);
  try {
    const res = await kase.request();
    const response = { status: res.status, contentType: res.headers.get('content-type'), body: await res.text() };
    await autoReply.whenIdle();
    return { response, saveCalls: save.mock.callCount() };
  } finally {
    save.mock.restore();
  }
}

// A response matches today's: the same status, and the same content type and body where they are known.
function assertExpected(response, expected, label) {
  assert.equal(response.status, expected.status, label);
  if (expected.body !== undefined) {
    assert.equal(response.contentType, expected.contentType, label);
    assert.equal(response.body, expected.body, label);
  }
}

describe('POST /api/whatsapp/webhook — AI auto-reply', () => {
  test('switch off: a newly saved message is answered 200 OK as today, and replyToLead is never called', async () => {
    const reply = mock.method(replyToLeadUseCase, 'replyToLead', async () => ({ status: 'replied' }));
    const { response, saveCalls } = await send(CASES['a new text message']);

    assert.deepEqual(response, OK);
    assert.equal(saveCalls, 1);
    assert.equal(reply.mock.callCount(), 0);
    assert.equal(autoReply.pendingConversations(), 0);
    assert.deepEqual(logs, []);
  });

  test('switch on: the 200 OK arrives while the job is still blocked, then replyToLead runs once with the saved ids', async () => {
    turnOn();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const reply = mock.method(replyToLeadUseCase, 'replyToLead', () => gate);
    mock.method(handleIncomingUseCase, 'handleIncomingWhatsAppMessage', async () => SAVED_TEXT);

    try {
      const res = await post(delivery());
      // The response is complete although the AI job has not finished (it cannot, until the gate opens).
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'OK');

      await waitUntil(() => reply.mock.callCount() === 1, 'the background job');
      assert.deepEqual(replyArgs(reply), [[11, 66]]);
      assert.equal(autoReply.pendingConversations(), 1, 'the job is still running');
    } finally {
      release({ status: 'replied' });
    }
    await autoReply.whenIdle();
    assert.equal(reply.mock.callCount(), 1);
    assert.equal(autoReply.pendingConversations(), 0);
    assert.deepEqual(logs, []);
  });

  test('switch on: duplicates, ignored messages, other events, a 400 and a 401 never call replyToLead', async () => {
    turnOn();
    const reply = mock.method(replyToLeadUseCase, 'replyToLead', async () => ({ status: 'replied' }));
    const labels = [
      'a duplicate delivery',
      'an own message',
      'a group message',
      'a channel message',
      'an unsupported type',
      'an empty text',
      'another event',
      'a malformed payload',
      'a bad signature',
    ];
    for (const label of labels) {
      const { response, saveCalls } = await send(CASES[label]);
      assertExpected(response, CASES[label].expected, label);
      assert.equal(saveCalls, label === 'a duplicate delivery' ? 1 : 0, label);
    }
    assert.equal(reply.mock.callCount(), 0);
    assert.equal(autoReply.pendingConversations(), 0);
  });

  test('switch on: a skipped message is 200 with the existing warn line, and replyToLead is never called', async () => {
    turnOn();
    const reply = mock.method(replyToLeadUseCase, 'replyToLead', async () => ({ status: 'replied' }));
    for (const reason of ['OpenWA has no phone number for this @lid sender', 'Invalid phone number: too short']) {
      const kase = { request: () => post(delivery()), save: async () => ({ skipped: true, reason }) };
      const first = logs.length;
      const { response } = await send(kase);
      assert.deepEqual(response, OK);
      assert.deepEqual(logs.slice(first), [['warn', `Skipped WhatsApp message ${logSafeId(MESSAGE_ID)}: ${reason}`]]);
    }
    assert.equal(reply.mock.callCount(), 0);
  });

  test('switch on: a failed save is the same 500 as today, and replyToLead is never called', async () => {
    turnOn();
    const reply = mock.method(replyToLeadUseCase, 'replyToLead', async () => ({ status: 'replied' }));
    const { response, saveCalls } = await send(CASES['a failed save']);

    assertExpected(response, CASES['a failed save'].expected, 'a failed save');
    assert.equal(saveCalls, 1);
    assert.deepEqual(logs, [['error', `Failed to save WhatsApp message ${logSafeId(MESSAGE_ID)} (P1001)`]]);
    assert.equal(reply.mock.callCount(), 0);
    assert.equal(autoReply.pendingConversations(), 0);
  });

  test('switch on: a job that rejects or throws changes no response, escapes nowhere, and the next message still gets its job', async () => {
    turnOn();
    const outcomes = [
      () => Promise.reject(Object.assign(new Error('leaky marker +12025550199'), { code: 'P1001' })),
      () => {
        throw new TypeError('leaky marker');
      },
      async () => ({ status: 'replied' }),
    ];
    let next = 0;
    const reply = mock.method(replyToLeadUseCase, 'replyToLead', () => outcomes[next++]());
    let messageId = 65;
    mock.method(handleIncomingUseCase, 'handleIncomingWhatsAppMessage', async () => ({ ...SAVED_TEXT, messageId: ++messageId }));

    for (let i = 0; i < 3; i += 1) {
      const res = await post(delivery());
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'OK');
    }
    await autoReply.whenIdle();
    await nextTurn();

    assert.deepEqual(replyArgs(reply), [[11, 66], [11, 67], [11, 68]]);
    assert.deepEqual(logs, [
      ['error', 'AI auto-reply conversation 11: job failed (P1001)'],
      ['error', 'AI auto-reply conversation 11: job failed (TypeError)'],
    ]);
    assert.deepEqual(unhandled, []);
    assert.equal(autoReply.pendingConversations(), 0);
  });

  test('every response is identical with the switch off and on; only new saves (text and media) call replyToLead', async () => {
    const reply = mock.method(replyToLeadUseCase, 'replyToLead', async () => ({ status: 'replied' }));

    for (const [label, kase] of Object.entries(CASES)) {
      const off = await send(kase);
      assert.equal(reply.mock.callCount(), 0, `${label}: the switch is off`);

      const on = mock.property(env, 'aiAutoReplyEnabled', true);
      const before = reply.mock.callCount();
      let onRun;
      try {
        onRun = await send(kase);
      } finally {
        on.mock.restore();
      }

      assert.deepEqual(onRun.response, off.response, `${label}: the same response with the switch on`);
      assertExpected(off.response, kase.expected, label);
      assert.deepEqual(replyArgs(reply).slice(before), kase.trigger ? [kase.trigger] : [], label);
      reply.mock.resetCalls();
    }
    assert.equal(autoReply.pendingConversations(), 0);
    assert.deepEqual(unhandled, []);
  });
});
