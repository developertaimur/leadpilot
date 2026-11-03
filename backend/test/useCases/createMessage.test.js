const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const conversationRepository = require('../../src/infrastructure/database/conversation.repository');
const messageRepository = require('../../src/infrastructure/database/message.repository');
const leadRepository = require('../../src/infrastructure/database/lead.repository');
const { channelSenders } = require('../../src/infrastructure/channels/channelSenders');
const { OpenWAError } = require('../../src/infrastructure/whatsapp/openwa.client');
const { createMessage } = require('../../src/application/useCases/createMessage.useCase');

function conversationWith(stage) {
  return { id: 5, leadId: 9, channel: 'WHATSAPP', lead: { id: 9, phoneNumber: '+923001234567', stage } };
}

function mockAll({ stage = 'NEW', send = async () => ({ messageId: 'true_923001234567@c.us_3EB0', timestamp: 1 }) } = {}) {
  return {
    find: mock.method(conversationRepository, 'findConversationById', async () => conversationWith(stage)),
    send: mock.method(channelSenders, 'WHATSAPP', send),
    save: mock.method(messageRepository, 'createMessage', async (data) => ({ id: 100, ...data })),
    stage: mock.method(leadRepository, 'updateLeadStage', async () => ({})),
  };
}

afterEach(() => mock.restoreAll());

describe('createMessage — outgoing (AI/HUMAN)', () => {
  test('AI message is sent, saved with the OpenWA messageId, and moves a NEW lead to CONTACTED', async () => {
    const m = mockAll();
    await createMessage(5, { sender: 'AI', content: '  Hello!  ' });
    assert.deepEqual(m.send.mock.calls[0].arguments, [conversationWith('NEW').lead, 'Hello!']);
    assert.deepEqual(m.save.mock.calls[0].arguments, [
      { conversationId: 5, sender: 'AI', content: 'Hello!', whatsappMessageId: 'true_923001234567@c.us_3EB0' },
    ]);
    assert.deepEqual(m.stage.mock.calls[0].arguments, [9, 'CONTACTED']);
  });

  test('HUMAN message to a lead past NEW does not change the stage', async () => {
    const m = mockAll({ stage: 'INTERESTED' });
    await createMessage(5, { sender: 'HUMAN', content: 'Following up' });
    assert.equal(m.send.mock.callCount(), 1);
    assert.equal(m.save.mock.callCount(), 1);
    assert.equal(m.stage.mock.callCount(), 0);
  });

  test('success without a messageId still saves the message (no whatsappMessageId) and moves the stage', async () => {
    const m = mockAll({ send: async () => ({ messageId: null, timestamp: null }) });
    await createMessage(5, { sender: 'AI', content: 'Hello' });
    assert.equal(m.save.mock.callCount(), 1);
    assert.equal(m.save.mock.calls[0].arguments[0].whatsappMessageId, undefined);
    assert.deepEqual(m.stage.mock.calls[0].arguments, [9, 'CONTACTED']);
  });

  test('a failed send saves nothing and leaves the stage alone', async () => {
    const m = mockAll({
      send: async () => {
        throw new OpenWAError('OpenWA is unreachable', { code: 'UNREACHABLE' });
      },
    });
    await assert.rejects(createMessage(5, { sender: 'AI', content: 'Hello' }), { message: 'OpenWA is unreachable' });
    assert.equal(m.save.mock.callCount(), 0);
    assert.equal(m.stage.mock.callCount(), 0);
  });
});

describe('createMessage — incoming and validation', () => {
  test('LEAD message is saved with its whatsappMessageId and nothing is sent', async () => {
    const m = mockAll();
    await createMessage(5, { sender: 'LEAD', content: 'Hi', whatsappMessageId: 'false_923001234567@c.us_ABC' });
    assert.equal(m.send.mock.callCount(), 0);
    assert.deepEqual(m.save.mock.calls[0].arguments, [
      { conversationId: 5, sender: 'LEAD', content: 'Hi', whatsappMessageId: 'false_923001234567@c.us_ABC' },
    ]);
    assert.equal(m.stage.mock.callCount(), 0);
  });

  test('invalid sender, empty content or unknown conversation is rejected before any send', async () => {
    const m = mockAll();
    await assert.rejects(createMessage(5, { sender: 'BOT', content: 'Hi' }), /Invalid sender/);
    await assert.rejects(createMessage(5, { sender: 'AI', content: '   ' }), { message: 'Message content is required' });
    m.find.mock.mockImplementation(async () => null);
    await assert.rejects(createMessage(5, { sender: 'AI', content: 'Hi' }), { message: 'Conversation not found' });
    assert.equal(m.send.mock.callCount(), 0);
    assert.equal(m.save.mock.callCount(), 0);
  });
});
