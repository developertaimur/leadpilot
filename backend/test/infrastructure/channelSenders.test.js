const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const openwaClient = require('../../src/infrastructure/whatsapp/openwa.client');
const { channelSenders } = require('../../src/infrastructure/channels/channelSenders');

afterEach(() => mock.restoreAll());

test("WHATSAPP sends to the lead's chat id through OpenWA and returns its result", async () => {
  const sendText = mock.method(openwaClient, 'sendText', async () => ({ messageId: 'wa-1', timestamp: 1 }));

  const result = await channelSenders.WHATSAPP({ phoneNumber: '+923001234567' }, 'Hello');

  assert.deepEqual(sendText.mock.calls[0].arguments, ['923001234567@c.us', 'Hello']);
  assert.deepEqual(result, { messageId: 'wa-1', timestamp: 1 });
});
