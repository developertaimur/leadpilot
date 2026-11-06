const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const leadRepository = require('../../src/infrastructure/database/lead.repository');
const conversationRepository = require('../../src/infrastructure/database/conversation.repository');
const messageRepository = require('../../src/infrastructure/database/message.repository');
const { channelSenders } = require('../../src/infrastructure/channels/channelSenders');
const { updateLeadStage } = require('../../src/application/useCases/updateLeadStage.useCase');
const { createMessage } = require('../../src/application/useCases/createMessage.useCase');

// Every lead repository function that writes, other than the stage writer itself.
const OTHER_LEAD_WRITERS = ['createLead', 'updateLeadInfo', 'updateLeadCampaign', 'updateAiSuggestion', 'deleteLead'];
const INVALID_STAGE = 'Invalid stage. Must be one of: NEW, CONTACTED, INTERESTED, QUALIFIED, CONVERTED, LOST';

afterEach(() => mock.restoreAll());

// The stage writer answers like the real one (stage set, suggestion cleared); every other writer refuses.
function mockLeadWriters() {
  const stage = mock.method(leadRepository, 'updateLeadStage', async (id, newStage) => ({
    id,
    stage: newStage,
    aiSuggestedStage: null,
    aiSuggestionReason: null,
  }));
  const others = OTHER_LEAD_WRITERS.map((name) =>
    mock.method(leadRepository, name, async () => {
      throw new Error(`${name} must not be called`);
    }),
  );
  return {
    stageCalls: () => stage.mock.calls.map((call) => call.arguments),
    assertOthersUnused: () => others.forEach((other) => assert.equal(other.mock.callCount(), 0)),
  };
}

describe('every path that changes Lead.stage goes through leadRepository.updateLeadStage', () => {
  test('PATCH stage: the lead is read, then updateLeadStage(id, stage) runs exactly once, also for the current stage', async () => {
    const writers = mockLeadWriters();
    const find = mock.method(leadRepository, 'findLeadById', async (id) => ({
      id,
      stage: 'CONTACTED',
      aiSuggestedStage: 'QUALIFIED',
      aiSuggestionReason: 'Asked for pricing',
    }));

    const result = await updateLeadStage(7, 'QUALIFIED');
    assert.deepEqual(find.mock.calls.map((call) => call.arguments), [[7]]);
    assert.deepEqual(writers.stageCalls(), [[7, 'QUALIFIED']]);
    assert.deepEqual(result, { id: 7, stage: 'QUALIFIED', aiSuggestedStage: null, aiSuggestionReason: null });

    // Setting the stage the lead already has goes through the same write, which clears the suggestion (a dismissal).
    await updateLeadStage(7, 'CONTACTED');
    assert.deepEqual(writers.stageCalls(), [
      [7, 'QUALIFIED'],
      [7, 'CONTACTED'],
    ]);
    writers.assertOthersUnused();
  });

  test('PATCH stage errors: an invalid stage is rejected before any repository call; a missing lead is "Lead not found" with no update', async () => {
    const writers = mockLeadWriters();
    const find = mock.method(leadRepository, 'findLeadById', async () => null);

    for (const stage of [undefined, null, '', 'qualified', 'WON']) {
      await assert.rejects(updateLeadStage(7, stage), { message: INVALID_STAGE });
    }
    assert.equal(find.mock.callCount(), 0);

    await assert.rejects(updateLeadStage(7, 'LOST'), { message: 'Lead not found' });
    assert.equal(find.mock.callCount(), 1);
    assert.deepEqual(writers.stageCalls(), []);
    writers.assertOthersUnused();
  });

  test('createMessage: an AI or HUMAN message to a NEW lead calls updateLeadStage(leadId, "CONTACTED") once; nothing else writes the lead', async () => {
    const writers = mockLeadWriters();
    let leadStage = 'NEW';
    mock.method(conversationRepository, 'findConversationById', async () => ({
      id: 5,
      leadId: 9,
      channel: 'WHATSAPP',
      lead: { id: 9, stage: leadStage },
    }));
    mock.method(channelSenders, 'WHATSAPP', async () => ({ messageId: 'fake-outgoing-id', timestamp: 1 }));
    mock.method(messageRepository, 'createMessage', async (data) => ({ id: 100, ...data }));

    await createMessage(5, { sender: 'AI', content: 'Hello' });
    await createMessage(5, { sender: 'HUMAN', content: 'Hello from the team' });
    assert.deepEqual(writers.stageCalls(), [
      [9, 'CONTACTED'],
      [9, 'CONTACTED'],
    ]);

    // A lead's own message, or any message to a lead already past NEW, writes no stage at all.
    await createMessage(5, { sender: 'LEAD', content: 'Hi', whatsappMessageId: 'fake-incoming-id' });
    leadStage = 'INTERESTED';
    await createMessage(5, { sender: 'AI', content: 'Hello again' });
    await createMessage(5, { sender: 'HUMAN', content: 'Following up' });
    assert.equal(writers.stageCalls().length, 2);
    writers.assertOthersUnused();
  });
});
