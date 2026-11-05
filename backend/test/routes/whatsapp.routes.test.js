const { test, describe, before, after, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startApp } = require('../helpers/startApp');
const env = require('../../src/config/env');
const messageRepository = require('../../src/infrastructure/database/message.repository');
const leadRepository = require('../../src/infrastructure/database/lead.repository');
const conversationRepository = require('../../src/infrastructure/database/conversation.repository');
const openwaClient = require('../../src/infrastructure/whatsapp/openwa.client');
const whatsappRoutes = require('../../src/api/routes/whatsapp.routes');

const SECRET = 'test-openwa-webhook-secret';
const TEXT = 'Salam, mera gym Lahore mein hai';
const NAME = 'Zarnab Qadir';
const PHONE_DIGITS = '923001234567';
const sign = (raw, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

let app;
before(async () => {
  app = await startApp(whatsappRoutes);
});
after(() => app.close());
afterEach(() => mock.restoreAll());

// In-memory stand-in for the repositories the webhook path touches.
function useFakeDb() {
  const db = { leads: [], conversations: [], messages: [] };
  const mocks = {
    findMessageByWhatsappId: mock.method(messageRepository, 'findMessageByWhatsappId', async (id) =>
      db.messages.find((m) => m.whatsappMessageId === id) ?? null),
    createMessage: mock.method(messageRepository, 'createMessage', async (data) => {
      const message = { id: db.messages.length + 1, ...data };
      db.messages.push(message);
      return message;
    }),
    findLeadByPhone: mock.method(leadRepository, 'findLeadByPhone', async (phone) =>
      db.leads.find((l) => l.phoneNumber === phone) ?? null),
    createLead: mock.method(leadRepository, 'createLead', async (data) => {
      const lead = { id: db.leads.length + 1, stage: 'NEW', ...data };
      db.leads.push(lead);
      return lead;
    }),
    findConversationByLeadId: mock.method(conversationRepository, 'findConversationByLeadId', async (leadId) =>
      db.conversations.find((c) => c.leadId === leadId) ?? null),
    createConversation: mock.method(conversationRepository, 'createConversation', async (leadId) => {
      const conversation = { id: db.conversations.length + 1, leadId, channel: 'WHATSAPP', humanTakeover: false };
      db.conversations.push(conversation);
      return conversation;
    }),
    findConversationById: mock.method(conversationRepository, 'findConversationById', async (id) => {
      const conversation = db.conversations.find((c) => c.id === id);
      return conversation && { ...conversation, lead: db.leads.find((l) => l.id === conversation.leadId) };
    }),
  };
  return { db, mocks };
}

// Captures every console line, so tests can check what gets logged (and keep test output clean).
function captureConsole() {
  const lines = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    mock.method(console, level, (...args) => lines.push({ level, line: args.join(' ') }));
  }
  return lines;
}

function delivery(data = {}) {
  return {
    event: 'message.received',
    timestamp: '2026-11-04T10:00:00.000Z',
    sessionId: 'test-openwa-session-id',
    idempotencyKey: 'msg_test',
    deliveryId: 'dlv_test',
    data: {
      id: `false_${PHONE_DIGITS}@c.us_3EB0A1B2C3D4`,
      from: `${PHONE_DIGITS}@c.us`,
      to: '923009999999@c.us',
      chatId: `${PHONE_DIGITS}@c.us`,
      body: TEXT,
      type: 'text',
      timestamp: 1730714400,
      isGroup: false,
      kind: 'individual',
      fromMe: false,
      contact: { pushName: NAME },
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

describe('POST /api/whatsapp/webhook — saving', () => {
  test('a valid text message creates the lead, the conversation and the LEAD message', async () => {
    const { db } = useFakeDb();
    captureConsole();

    const res = await post(delivery());

    assert.equal(res.status, 200);
    assert.equal(db.leads.length, 1);
    assert.equal(db.leads[0].phoneNumber, '+923001234567');
    assert.equal(db.leads[0].name, NAME);
    assert.equal(db.leads[0].source, 'whatsapp_inbound');
    assert.equal(db.conversations.length, 1);
    assert.deepEqual(db.messages, [
      {
        id: 1,
        conversationId: 1,
        sender: 'LEAD',
        content: TEXT,
        whatsappMessageId: `false_${PHONE_DIGITS}@c.us_3EB0A1B2C3D4`,
      },
    ]);
  });

  test('the same delivery twice is answered 200 both times and stored once', async () => {
    const { db } = useFakeDb();
    captureConsole();
    assert.equal((await post(delivery())).status, 200);
    assert.equal((await post(delivery())).status, 200);
    assert.equal(db.messages.length, 1);
    assert.equal(db.leads.length, 1);
  });

  test('each media type is saved as its placeholder, keeping a caption', async () => {
    const { db } = useFakeDb();
    captureConsole();
    const placeholders = {
      voice: '[voice note]',
      audio: '[audio]',
      image: '[image]',
      video: '[video]',
      document: '[document]',
      sticker: '[sticker]',
    };
    for (const [type, placeholder] of Object.entries(placeholders)) {
      const res = await post(delivery({ id: `false_${PHONE_DIGITS}@c.us_${type.toUpperCase()}0001`, type, body: '' }));
      assert.equal(res.status, 200);
      assert.equal(db.messages.at(-1).content, placeholder);
    }
    await post(delivery({ id: `false_${PHONE_DIGITS}@c.us_CAPTION0001`, type: 'image', body: 'Is this the price list?' }));
    assert.equal(db.messages.at(-1).content, '[image] Is this the price list?');
    assert.equal(db.messages.length, 7);
  });
});

describe('POST /api/whatsapp/webhook — ignored with 200', () => {
  test('own, group, channel, status and broadcast messages', async () => {
    const { db } = useFakeDb();
    captureConsole();
    const cases = [{ fromMe: true }, { isGroup: true, kind: 'group' }, { kind: 'channel' }, { kind: 'status' }, { kind: 'broadcast' }];
    for (const data of cases) {
      assert.equal((await post(delivery(data))).status, 200);
    }
    assert.equal(db.messages.length, 0);
    assert.equal(db.leads.length, 0);
  });

  test('every unsupported type, and empty text', async () => {
    const { db } = useFakeDb();
    captureConsole();
    for (const type of ['revoked', 'call', 'poll', 'location', 'contact', 'order', 'product', 'masked', 'unknown']) {
      assert.equal((await post(delivery({ type }))).status, 200);
    }
    assert.equal((await post(delivery({ body: '   ' }))).status, 200);
    assert.equal(db.messages.length, 0);
  });

  test('an ignored message logs one line with the reason, kind and type', async () => {
    useFakeDb();
    const logs = captureConsole();
    await post(delivery({ isGroup: true, kind: 'group', id: 'false_120363000000000000@g.us_3EB0A1B2C3D4_923001234567@c.us' }));
    assert.deepEqual(logs, [
      { level: 'info', line: 'Ignored WhatsApp message 3EB0A1B2C3D4: not a 1:1 chat, kind=group type=text' },
    ]);
  });

  test('other events (test, message.ack, session.status) are ignored without any log line', async () => {
    const { db } = useFakeDb();
    const logs = captureConsole();
    for (const event of ['test', 'message.ack', 'session.status']) {
      assert.equal((await post({ event, sessionId: 'test-openwa-session-id', data: {} })).status, 200);
    }
    assert.equal(db.messages.length, 0);
    assert.deepEqual(logs, []);
  });
});

describe('POST /api/whatsapp/webhook — rejected', () => {
  test('wrong secret, missing header, changed body and unconfigured secret are all 401', async () => {
    const { db } = useFakeDb();
    captureConsole();
    const raw = JSON.stringify(delivery());
    assert.equal((await post(null, { raw, signature: sign(raw, 'another-secret-value') })).status, 401);
    assert.equal((await post(null, { raw, signature: null })).status, 401);
    assert.equal((await post(null, { raw: raw.replace('Lahore', 'Karachi'), signature: sign(raw) })).status, 401);
    mock.property(env, 'openwaWebhookSecret', '');
    assert.equal((await post(null, { raw })).status, 401);
    assert.equal(db.messages.length, 0);
  });

  test('the same JSON re-serialized with different whitespace fails: the signature covers the raw bytes', async () => {
    const { db } = useFakeDb();
    captureConsole();
    const payload = delivery();
    const res = await post(null, { raw: JSON.stringify(payload, null, 2), signature: sign(JSON.stringify(payload)) });
    assert.equal(res.status, 401);
    assert.equal(db.messages.length, 0);
  });

  test('malformed JSON is 400 with a JSON error', async () => {
    useFakeDb();
    captureConsole();
    const res = await post(null, { raw: '{"event": "message.received", "data": ' });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Malformed JSON body' });
  });

  test('a signed payload with the wrong shape is 400', async () => {
    const { db } = useFakeDb();
    captureConsole();
    assert.equal((await post({ data: {} })).status, 400);
    assert.equal((await post({ event: 'message.received', data: { id: 'x' } })).status, 400);
    assert.equal((await post([])).status, 400);
    assert.equal(db.messages.length, 0);
  });

  test('GET is no longer served', async () => {
    assert.equal((await fetch(`${app.baseUrl}/api/whatsapp/webhook`)).status, 404);
  });
});

describe('POST /api/whatsapp/webhook — @lid senders', () => {
  const lid = (data) =>
    delivery({ id: 'false_1234567890@lid_3EB0A1B2C3D4', chatId: '1234567890@lid', from: '1234567890@lid', isLidSender: true, ...data });

  test('uses senderPhone when OpenWA sends it, without a lookup', async () => {
    const { db } = useFakeDb();
    captureConsole();
    const lookup = mock.method(openwaClient, 'resolveLidPhone');
    assert.equal((await post(lid({ senderPhone: PHONE_DIGITS }))).status, 200);
    assert.equal(db.leads[0].phoneNumber, '+923001234567');
    assert.equal(db.messages.length, 1);
    assert.equal(lookup.mock.callCount(), 0);
  });

  test('otherwise makes exactly one lookup', async () => {
    const { db } = useFakeDb();
    captureConsole();
    const lookup = mock.method(openwaClient, 'resolveLidPhone', async () => PHONE_DIGITS);
    assert.equal((await post(lid())).status, 200);
    assert.deepEqual(lookup.mock.calls.map((call) => call.arguments), [['1234567890@lid']]);
    assert.equal(db.leads[0].phoneNumber, '+923001234567');
    assert.equal(db.messages.length, 1);
  });

  test('skips the message and logs one line when no phone can be found', async () => {
    const { db } = useFakeDb();
    const logs = captureConsole();
    mock.method(openwaClient, 'resolveLidPhone', async () => null);
    assert.equal((await post(lid())).status, 200);
    assert.equal(db.messages.length, 0);
    assert.equal(db.leads.length, 0);
    assert.deepEqual(logs, [
      { level: 'warn', line: 'Skipped WhatsApp message 3EB0A1B2C3D4: OpenWA has no phone number for this @lid sender' },
    ]);
  });
});

describe('POST /api/whatsapp/webhook — failures and logging', () => {
  test('a database failure is 500, so OpenWA retries', async () => {
    const logs = captureConsole();
    mock.method(messageRepository, 'findMessageByWhatsappId', async () => {
      throw Object.assign(new Error("Can't reach database server"), { code: 'P1001' });
    });
    const res = await post(delivery());
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Failed to process message' });
    assert.deepEqual(logs, [{ level: 'error', line: 'Failed to save WhatsApp message 3EB0A1B2C3D4 (P1001)' }]);
  });

  test('message text, names and phone numbers never appear in any console output', async () => {
    const { mocks } = useFakeDb();
    const logs = captureConsole();
    mock.method(openwaClient, 'resolveLidPhone', async () => null);

    await post(delivery()); // saved
    await post(delivery()); // duplicate
    await post(delivery({ isGroup: true, kind: 'group', id: 'false_120363000000000000@g.us_3EB0FFFF0001_923001234567@c.us' })); // ignored
    await post(delivery({ type: 'poll', id: `false_${PHONE_DIGITS}@c.us_3EB0FFFF0002` })); // ignored
    await post(delivery({ id: 'false_1234567890@lid_3EB0FFFF0003', chatId: '1234567890@lid' })); // skipped
    mocks.createMessage.mock.mockImplementation(async () => {
      throw new Error(`Invalid value for content: ${TEXT}`);
    });
    await post(delivery({ id: `false_${PHONE_DIGITS}@c.us_3EB0FFFF0004` })); // failed

    assert.equal(logs.length, 4);
    const output = logs.map((entry) => entry.line).join('\n');
    for (const secret of [TEXT, 'Lahore', 'Zarnab', PHONE_DIGITS, '1234567890']) {
      assert.ok(!output.includes(secret), `console output contains "${secret}"`);
    }
  });
});
