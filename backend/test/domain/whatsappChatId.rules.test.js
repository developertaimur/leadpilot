const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toChatId } = require('../../src/domain/rules/whatsappChatId.rules');

test('toChatId turns an E.164 number into a 1:1 chat id', () => {
  assert.equal(toChatId('+923001234567'), '923001234567@c.us');
  assert.equal(toChatId('+14155552671'), '14155552671@c.us');
});

test('toChatId rejects anything that is not E.164', () => {
  for (const bad of ['923001234567', '+92 300 1234567', '+0123456789', '', null, undefined, 923001234567]) {
    assert.throws(() => toChatId(bad), { message: 'Phone number is not in E.164 format' });
  }
});
