const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toChatId, phoneFromChatId } = require('../../src/domain/rules/whatsappChatId.rules');

test('toChatId turns an E.164 number into a 1:1 chat id', () => {
  assert.equal(toChatId('+923001234567'), '923001234567@c.us');
  assert.equal(toChatId('+14155552671'), '14155552671@c.us');
});

test('toChatId rejects anything that is not E.164', () => {
  for (const bad of ['923001234567', '+92 300 1234567', '+0123456789', '', null, undefined, 923001234567]) {
    assert.throws(() => toChatId(bad), { message: 'Phone number is not in E.164 format' });
  }
});

test('phoneFromChatId returns E.164 for a 1:1 chat id and null for anything else', () => {
  assert.equal(phoneFromChatId('923001234567@c.us'), '+923001234567');
  for (const other of ['1234567890@lid', '120363000000000000@g.us', 'status@broadcast', 'abc@c.us', '0123456@c.us', '', null, undefined]) {
    assert.equal(phoneFromChatId(other), null);
  }
});
