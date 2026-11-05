const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const messageRepository = require('../../src/infrastructure/database/message.repository');
const leadRepository = require('../../src/infrastructure/database/lead.repository');
const openwaClient = require('../../src/infrastructure/whatsapp/openwa.client');
const { handleIncomingWhatsAppMessage } = require('../../src/application/useCases/handleIncomingWhatsAppMessage.useCase');

const { OpenWAError } = openwaClient;

function incoming(overrides = {}) {
  return {
    chatId: '1234567890@lid',
    senderPhone: null,
    text: 'Hello',
    name: 'Zarnab',
    whatsappMessageId: 'false_1234567890@lid_3EB0A1B2C3D4',
    ...overrides,
  };
}

afterEach(() => mock.restoreAll());

test('a duplicate is detected before any phone lookup', async () => {
  mock.method(messageRepository, 'findMessageByWhatsappId', async () => ({ id: 77 }));
  const lookup = mock.method(openwaClient, 'resolveLidPhone');
  assert.deepEqual(await handleIncomingWhatsAppMessage(incoming()), { duplicate: true, messageId: 77 });
  assert.equal(lookup.mock.callCount(), 0);
});

test('a failed @lid lookup skips the message with a reason that holds no message details', async () => {
  mock.method(messageRepository, 'findMessageByWhatsappId', async () => null);
  mock.method(openwaClient, 'resolveLidPhone', async () => {
    throw new OpenWAError('OpenWA is unreachable', { code: 'UNREACHABLE' });
  });
  const findLead = mock.method(leadRepository, 'findLeadByPhone');
  assert.deepEqual(await handleIncomingWhatsAppMessage(incoming()), {
    skipped: true,
    reason: 'Phone lookup failed (UNREACHABLE)',
  });
  assert.equal(findLead.mock.callCount(), 0);
});

test('an invalid phone number is skipped', async () => {
  mock.method(messageRepository, 'findMessageByWhatsappId', async () => null);
  const findLead = mock.method(leadRepository, 'findLeadByPhone');
  assert.deepEqual(await handleIncomingWhatsAppMessage(incoming({ senderPhone: '12345' })), {
    skipped: true,
    reason: 'Invalid phone number: Not a valid phone number',
  });
  assert.equal(findLead.mock.callCount(), 0);
});

test('a chat id that is neither @c.us nor @lid is skipped without a lookup', async () => {
  mock.method(messageRepository, 'findMessageByWhatsappId', async () => null);
  const lookup = mock.method(openwaClient, 'resolveLidPhone');
  assert.deepEqual(await handleIncomingWhatsAppMessage(incoming({ chatId: '120363000000000000@g.us' })), {
    skipped: true,
    reason: 'Unsupported chat id',
  });
  assert.equal(lookup.mock.callCount(), 0);
});
