const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  STAGES,
  MAX_REPLY_LENGTH,
  assertReplyRequest,
  parseStructuredReply,
} = require('../../src/infrastructure/ai/replyValidation');
const { VALID_REPLY, INVALID_REPLY_TEXTS } = require('../helpers/invalidReplies');

test('STAGES are the six lead stages in schema order, and replies are capped at 4096 characters', () => {
  assert.deepEqual(STAGES, ['NEW', 'CONTACTED', 'INTERESTED', 'QUALIFIED', 'CONVERTED', 'LOST']);
  assert.equal(MAX_REPLY_LENGTH, 4096);
});

test('a valid reply gives exactly the four fields, trimmed, with extra fields dropped', () => {
  assert.deepEqual(parseStructuredReply(JSON.stringify({ ...VALID_REPLY, confidence: 0.9 })), {
    value: {
      reply: 'Great, 150 members! Would a free 7-day demo help?',
      suggestedStage: 'INTERESTED',
      reason: 'Shared the gym size',
      requiresHuman: false,
    },
  });
  assert.deepEqual(parseStructuredReply(JSON.stringify({ ...VALID_REPLY, suggestedStage: null, reason: '' })).value, {
    reply: 'Great, 150 members! Would a free 7-day demo help?',
    suggestedStage: null,
    reason: '',
    requiresHuman: false,
  });
  for (const stage of STAGES) {
    assert.equal(parseStructuredReply(JSON.stringify({ ...VALID_REPLY, suggestedStage: stage })).value.suggestedStage, stage);
  }
  assert.equal(parseStructuredReply(JSON.stringify({ ...VALID_REPLY, reply: 'x'.repeat(4096) })).value.reply.length, 4096);
});

test('every invalid reply returns exactly { error: "INVALID_RESPONSE" } and never throws', () => {
  for (const [label, text] of Object.entries(INVALID_REPLY_TEXTS)) {
    assert.deepEqual(parseStructuredReply(text), { error: 'INVALID_RESPONSE' }, label);
  }
  for (const notText of [undefined, null, 42, {}]) {
    assert.deepEqual(parseStructuredReply(notText), { error: 'INVALID_RESPONSE' });
  }
});

test('an invalid result never carries the model text', () => {
  const marker = 'model text marker 9917';
  const result = parseStructuredReply(JSON.stringify({ ...VALID_REPLY, reply: 42, reason: marker }));
  assert.deepEqual(result, { error: 'INVALID_RESPONSE' });
  assert.ok(!JSON.stringify(result).includes(marker));
});

test('assertReplyRequest accepts a valid request and rejects a bad one with a plain TypeError holding no text', () => {
  assert.doesNotThrow(() => assertReplyRequest('System text', [{ role: 'user', text: 'Hi' }, { role: 'model', text: 'Hello' }]));

  const marker = 'request text marker 5521';
  const bad = [
    ['', [{ role: 'user', text: marker }]],
    [marker, []],
    [marker, 'not an array'],
    [marker, [{ role: 'assistant', text: marker }]],
    [marker, [{ role: 'user', text: '   ' }]],
    [marker, [{ role: 'user', text: 42 }]],
  ];
  for (const [systemInstruction, messages] of bad) {
    assert.throws(
      () => assertReplyRequest(systemInstruction, messages),
      (err) => err instanceof TypeError && !err.message.includes(marker),
    );
  }
});
