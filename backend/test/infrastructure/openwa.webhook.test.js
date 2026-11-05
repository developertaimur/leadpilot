const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifySignature, parseIncoming, logSafeId } = require('../../src/infrastructure/whatsapp/openwa.webhook');

const SECRET = 'test-openwa-webhook-secret';
const sign = (raw, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

function delivery(data = {}) {
  return {
    event: 'message.received',
    data: {
      id: 'false_923001234567@c.us_3EB0A1B2C3D4',
      chatId: '923001234567@c.us',
      from: '923001234567@c.us',
      body: 'Hello there',
      type: 'text',
      isGroup: false,
      kind: 'individual',
      fromMe: false,
      contact: { pushName: 'Zarnab', name: 'Zarnab Qadir' },
      ...data,
    },
  };
}

describe('verifySignature', () => {
  const raw = Buffer.from(JSON.stringify(delivery()));

  test('accepts the HMAC-SHA256 of the raw body', () => {
    assert.equal(verifySignature(raw, sign(raw), SECRET), true);
  });

  test('rejects a wrong secret, a changed body, a missing or malformed header, no secret and no body', () => {
    assert.equal(verifySignature(raw, sign(raw, 'another-secret-value'), SECRET), false);
    assert.equal(verifySignature(Buffer.from(`${raw} `), sign(raw), SECRET), false);
    assert.equal(verifySignature(raw, undefined, SECRET), false);
    assert.equal(verifySignature(raw, sign(raw).replace('sha256=', ''), SECRET), false);
    assert.equal(verifySignature(raw, 'sha256=abc', SECRET), false);
    assert.equal(verifySignature(raw, sign(raw), ''), false);
    assert.equal(verifySignature(undefined, sign(raw), SECRET), false);
  });
});

describe('parseIncoming', () => {
  test('maps a text message to the lead message fields', () => {
    assert.deepEqual(parseIncoming(delivery()), {
      chatId: '923001234567@c.us',
      senderPhone: null,
      text: 'Hello there',
      name: 'Zarnab',
      whatsappMessageId: 'false_923001234567@c.us_3EB0A1B2C3D4',
    });
  });

  test('name is pushName, then the saved contact name, else null; non-string fields are ignored', () => {
    assert.equal(parseIncoming(delivery({ contact: { name: 'Zarnab Qadir' } })).name, 'Zarnab Qadir');
    assert.equal(parseIncoming(delivery({ contact: undefined })).name, null);
    assert.equal(parseIncoming(delivery({ contact: { pushName: 42, name: '  ' } })).name, null);
    assert.equal(parseIncoming(delivery({ senderPhone: 923001234567 })).senderPhone, null);
  });

  test('returns null for events other than message.received', () => {
    for (const event of ['test', 'message.ack', 'session.status']) {
      assert.equal(parseIncoming({ event, data: {} }), null);
    }
  });

  test('says why a message is ignored, with its kind and type', () => {
    assert.deepEqual(parseIncoming(delivery({ fromMe: true })), {
      ignored: 'own message',
      whatsappMessageId: 'false_923001234567@c.us_3EB0A1B2C3D4',
      kind: 'individual',
      type: 'text',
    });
    assert.equal(parseIncoming(delivery({ isGroup: true })).ignored, 'not a 1:1 chat');
    assert.equal(parseIncoming(delivery({ kind: 'channel' })).ignored, 'not a 1:1 chat');
    assert.equal(parseIncoming(delivery({ kind: undefined })).ignored, 'not a 1:1 chat');
    assert.equal(parseIncoming(delivery({ type: 'poll' })).ignored, 'unsupported type');
    assert.equal(parseIncoming(delivery({ type: 'constructor' })).ignored, 'unsupported type');
    assert.equal(parseIncoming(delivery({ body: '   ' })).ignored, 'empty text');
  });

  test('never echoes an unexpected kind or type value', () => {
    const result = parseIncoming(delivery({ kind: 'Hello there, my number is 0300', type: 'text' }));
    assert.equal(result.kind, 'unknown');
  });

  test('media becomes a placeholder, keeping a caption', () => {
    assert.equal(parseIncoming(delivery({ type: 'voice', body: '' })).text, '[voice note]');
    assert.equal(parseIncoming(delivery({ type: 'image', body: '  Is this the price list?  ' })).text, '[image] Is this the price list?');
  });

  test('throws on a malformed payload', () => {
    const malformed = [
      null,
      [],
      'text',
      { data: {} },
      { event: 'message.received' },
      { event: 'message.received', data: { id: 'x', chatId: 'y' } },
      { event: 'message.received', data: { id: '', chatId: 'y', type: 'text' } },
    ];
    for (const payload of malformed) {
      assert.throws(() => parseIncoming(payload));
    }
  });
});

describe('logSafeId', () => {
  test('keeps only the hash part of whatsapp-web.js ids, so no phone number is logged', () => {
    assert.equal(logSafeId('false_923001234567@c.us_3EB0A1B2C3D4'), '3EB0A1B2C3D4');
    assert.equal(logSafeId('false_120363000000000000@g.us_3EB0A1B2C3D4_923001234567@c.us'), '3EB0A1B2C3D4');
    assert.equal(logSafeId('3EB0A1B2C3D4'), '3EB0A1B2C3D4');
    assert.equal(logSafeId('923001234567'), 'unknown');
  });
});
