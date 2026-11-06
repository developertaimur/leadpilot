const { test, describe, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const conversationRepository = require('../../src/infrastructure/database/conversation.repository');
const businessProfileRepository = require('../../src/infrastructure/database/businessProfile.repository');
const messageRepository = require('../../src/infrastructure/database/message.repository');
const leadRepository = require('../../src/infrastructure/database/lead.repository');
const createMessageUseCase = require('../../src/application/useCases/createMessage.useCase');
const setAiSuggestionUseCase = require('../../src/application/useCases/setAiSuggestion.useCase');
const setHumanTakeoverUseCase = require('../../src/application/useCases/setHumanTakeover.useCase');
const generateReplyModule = require('../../src/application/ai/generateReply');
const { buildAiRequest } = require('../../src/application/ai/contextBuilder');
const { OpenWAError } = require('../../src/infrastructure/whatsapp/openwa.client');
const { replyToLead } = require('../../src/application/useCases/replyToLead.useCase');

const { FALLBACK_REPLY } = generateReplyModule;

// Fake data only. Every text that must stay out of the logs carries the word "marker".
const CONVERSATION_ID = 11;
const LEAD_ID = 23;
const TRIGGER_ID = 66;
const PHONE = '+12025550199';
const LEAD = {
  id: LEAD_ID,
  name: 'Fakelead Markername',
  phoneNumber: PHONE,
  stage: 'NEW',
  aiSuggestedStage: null,
  aiSuggestionReason: null,
  source: 'whatsapp_inbound',
  campaignId: null,
};
const PROFILE = { id: 1, name: 'FitTrack', context: 'Business context marker 9001', salesInstructions: 'Sales marker 9002' };
const MESSAGES = [
  { id: 64, conversationId: CONVERSATION_ID, sender: 'AI', content: 'Greeting marker 9003' },
  { id: 65, conversationId: CONVERSATION_ID, sender: 'LEAD', content: 'Lead text marker 9004' },
  { id: TRIGGER_ID, conversationId: CONVERSATION_ID, sender: 'LEAD', content: 'Lead text marker 9005' },
];
const REPLY = {
  reply: 'Reply marker 9006',
  suggestedStage: 'INTERESTED',
  reason: 'Reason marker 9007',
  requiresHuman: true,
  provider: 'gemini',
  errorCode: null,
};
const FALLBACK = {
  reply: FALLBACK_REPLY,
  suggestedStage: null,
  reason: 'AI unavailable',
  requiresHuman: true,
  provider: 'fallback',
  errorCode: 'TIMEOUT',
};
const PREFIX = `AI pipeline conversation ${CONVERSATION_ID}`;
const PREFIX_LEAD = `${PREFIX} lead ${LEAD_ID}`;
const LEAKS = ['marker', 'Marker', PHONE, '2025550199', 'Fakelead', 'leaky'];
// Every lead repository function that writes.
const LEAD_WRITERS = ['updateLeadStage', 'updateLeadInfo', 'updateLeadCampaign', 'updateAiSuggestion', 'createLead', 'deleteLead'];

const conversation = (overrides = {}) => ({
  id: CONVERSATION_ID,
  leadId: LEAD_ID,
  humanTakeover: false,
  channel: 'WHATSAPP',
  lead: { ...LEAD },
  ...overrides,
});
const fail = (thrown) => () => {
  throw thrown;
};
const resolve = (option, ...args) => (typeof option === 'function' ? option(...args) : option);
const names = (calls) => calls.map((call) => call[0]);

let logs; // [method, text] for every console call in the current test
let fetchSpy;

beforeEach(() => {
  logs = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    mock.method(console, method, (...args) => logs.push([method, args.join(' ')]));
  }
  fetchSpy = mock.method(globalThis, 'fetch', async () => {
    throw new Error('replyToLead tests must not use the network');
  });
});
afterEach(() => {
  try {
    assert.equal(fetchSpy.mock.callCount(), 0, 'no network');
  } finally {
    mock.restoreAll();
  }
});

// Mocks every dependency. Each option is a value, or a function (called with the arguments) for errors.
// `conversations` gives the answer of each findConversationWithLead call in turn.
function mockAll({
  conversations = [conversation(), conversation()],
  profile = PROFILE,
  messages = MESSAGES,
  newest,
  reply = REPLY,
  send = async () => ({ id: 67 }),
  reloadedLead = { ...LEAD, stage: 'CONTACTED' },
  saveSuggestion = async () => ({}),
  setTakeover = async () => ({}),
} = {}) {
  const calls = [];
  const mocks = [];
  const on = (object, name, impl) => {
    mocks.push(
      mock.method(object, name, async (...args) => {
        calls.push([name, ...args]);
        return impl(...args);
      }),
    );
  };
  let loads = 0;
  on(conversationRepository, 'findConversationWithLead', () => resolve(conversations[loads++]));
  on(businessProfileRepository, 'getBusinessProfile', () => resolve(profile));
  on(messageRepository, 'findLastMessagesByConversation', (id, limit) => {
    if (limit !== 1) return resolve(messages);
    return newest !== undefined ? resolve(newest) : [resolve(messages).at(-1)].filter(Boolean);
  });
  on(generateReplyModule, 'generateReply', (input) => resolve(reply, input));
  on(createMessageUseCase, 'createMessage', send);
  on(leadRepository, 'findLeadById', () => resolve(reloadedLead));
  on(setAiSuggestionUseCase, 'setAiSuggestion', saveSuggestion);
  on(setHumanTakeoverUseCase, 'setHumanTakeover', setTakeover);
  const writers = LEAD_WRITERS.map((name) =>
    mock.method(leadRepository, name, async () => {
      throw new Error(`${name} must not be called`);
    }),
  );
  return {
    calls,
    writers,
    restore: () => [...mocks, ...writers].forEach((m) => m.mock.restore()),
  };
}

// One replyToLead call with everything mocked. Returns the result, the mocked calls in order (name and
// arguments), the console lines of this call, and the refusing lead writers.
// `ids` given explicitly (even as undefined) are passed as they are, so bad ids can be tested.
async function run(options = {}, ids = {}) {
  const conversationId = Object.hasOwn(ids, 'conversationId') ? ids.conversationId : CONVERSATION_ID;
  const triggerMessageId = Object.hasOwn(ids, 'triggerMessageId') ? ids.triggerMessageId : TRIGGER_ID;
  const m = mockAll(options);
  const first = logs.length;
  try {
    const result = await replyToLead(conversationId, triggerMessageId);
    return { result, calls: m.calls, lines: logs.slice(first), writers: m.writers };
  } finally {
    m.restore();
  }
}

const SEND_FAILURES = [
  [new OpenWAError('OpenWA is unreachable', { code: 'UNREACHABLE', neverConnected: true }), 'UNREACHABLE'],
  [new OpenWAError('OpenWA is unreachable', { code: 'UNREACHABLE' }), 'UNREACHABLE'],
  [new OpenWAError('OpenWA did not answer within 15000 ms', { code: 'TIMEOUT' }), 'TIMEOUT'],
  [new OpenWAError('OpenWA is not configured', { code: 'NOT_CONFIGURED' }), 'NOT_CONFIGURED'],
  [new OpenWAError('Send pacing limit reached', { status: 429, code: 'SEND_PACING_LIMITED' }), 'SEND_PACING_LIMITED'],
  [new OpenWAError('OpenWA error 400: bad request', { status: 400 }), 'HTTP_400'],
  [new OpenWAError('OpenWA error 500: internal', { status: 500 }), 'HTTP_500'],
  [Object.assign(new Error('database down after the send'), { code: 'P1001' }), 'P1001'],
  [new Error('something broke'), 'Error'],
  [undefined, 'UNEXPECTED'],
];

const LEAKY = Object.assign(new Error(`leaky message marker ${PHONE} Fakelead`), { code: 'P1001' });

// Every kind of outcome, for the tests that check all of them at once.
const SCENARIOS = {
  'replied via gemini': {},
  'replied via groq': { reply: { ...REPLY, provider: 'groq' } },
  'replied via the fallback': { reply: FALLBACK },
  'plain reply': { reply: { ...REPLY, suggestedStage: null, requiresHuman: false } },
  'conversation not found': { conversations: [null] },
  'human takeover': { conversations: [conversation({ humanTakeover: true })] },
  'no business context': { profile: null },
  'nothing to answer': { messages: [MESSAGES[0], { ...MESSAGES[2], sender: 'HUMAN' }] },
  'takeover during the AI call': { conversations: [conversation(), conversation({ humanTakeover: true })] },
  'superseded during the AI call': { newest: [{ ...MESSAGES[2], id: 67 }] },
  'send failed': { send: fail(LEAKY) },
  'send failed, requiresHuman false': { reply: { ...REPLY, requiresHuman: false }, send: fail(LEAKY) },
  'suggestion failed': { saveSuggestion: fail(LEAKY) },
  'takeover failed': { setTakeover: fail(LEAKY) },
  'unexpected error while loading': { conversations: [fail(LEAKY)] },
  'unexpected error while answering': { reply: fail(LEAKY) },
};

describe('replyToLead — the happy path', () => {
  test('every call in the exact order with exact arguments; the result and the single info line', async () => {
    const { result, calls, lines } = await run();
    const request = buildAiRequest({ businessProfile: PROFILE, messages: MESSAGES, lead: LEAD });

    assert.deepEqual(calls, [
      ['findConversationWithLead', CONVERSATION_ID],
      ['getBusinessProfile'],
      ['findLastMessagesByConversation', CONVERSATION_ID, 20],
      ['generateReply', { request, currentStage: 'NEW' }],
      ['findConversationWithLead', CONVERSATION_ID],
      ['findLastMessagesByConversation', CONVERSATION_ID, 1],
      ['createMessage', CONVERSATION_ID, { sender: 'AI', content: 'Reply marker 9006' }],
      ['findLeadById', LEAD_ID],
      ['setAiSuggestion', LEAD_ID, 'INTERESTED', 'Reason marker 9007'],
      ['setHumanTakeover', CONVERSATION_ID, true],
    ]);
    assert.deepEqual(result, { status: 'replied', provider: 'gemini', requiresHuman: true, suggestionSaved: true, errorCode: null });
    assert.deepEqual(lines, [['info', `${PREFIX_LEAD}: replied via gemini, suggestion INTERESTED saved, takeover set`]]);
  });

  test('a plain reply (no suggestion, no human needed) sends and stops: no lead reload, no suggestion, no takeover', async () => {
    const { result, calls, lines } = await run(SCENARIOS['plain reply']);
    assert.deepEqual(names(calls), [
      'findConversationWithLead',
      'getBusinessProfile',
      'findLastMessagesByConversation',
      'generateReply',
      'findConversationWithLead',
      'findLastMessagesByConversation',
      'createMessage',
    ]);
    assert.deepEqual(result, { status: 'replied', provider: 'gemini', requiresHuman: false, suggestionSaved: false, errorCode: null });
    assert.deepEqual(lines, [['info', `${PREFIX_LEAD}: replied via gemini`]]);
  });

  test('the trigger: the newest message proceeds; an older one is superseded before the AI; bad ids fail BAD_REQUEST with no call', async () => {
    const newest = await run();
    assert.ok(names(newest.calls).includes('generateReply'));
    assert.equal(newest.result.status, 'replied');

    const older = await run({}, { triggerMessageId: 65 });
    assert.deepEqual(older.result, { status: 'skipped', reason: 'superseded' });
    assert.deepEqual(names(older.calls), ['findConversationWithLead', 'getBusinessProfile', 'findLastMessagesByConversation']);
    assert.deepEqual(older.lines, [['info', `${PREFIX_LEAD}: skipped superseded before ai`]]);

    const noMessages = await run({ messages: [] });
    assert.deepEqual(noMessages.result, { status: 'skipped', reason: 'superseded' });
    assert.ok(!names(noMessages.calls).includes('generateReply'));

    const badIds = [
      [undefined, TRIGGER_ID],
      [null, TRIGGER_ID],
      ['11', TRIGGER_ID],
      [0, TRIGGER_ID],
      [5.5, TRIGGER_ID],
      [CONVERSATION_ID, undefined],
      [CONVERSATION_ID, -1],
      [CONVERSATION_ID, '66'],
      [CONVERSATION_ID, NaN],
      [],
    ];
    for (const [conversationId, triggerMessageId] of badIds) {
      const { result, calls, lines } = await run({}, { conversationId, triggerMessageId });
      assert.deepEqual(result, { status: 'failed', step: 'input', errorCode: 'BAD_REQUEST' }, String([conversationId, triggerMessageId]));
      assert.deepEqual(calls, []);
      assert.deepEqual(lines, [['error', 'AI pipeline: failed bad_request']]);
    }

    // No arguments at all.
    const m = mockAll();
    try {
      assert.deepEqual(await replyToLead(), { status: 'failed', step: 'input', errorCode: 'BAD_REQUEST' });
      assert.deepEqual(m.calls, []);
    } finally {
      m.restore();
    }
  });
});

describe('replyToLead — skips', () => {
  test('every skip before the AI call: no generateReply, no send, no write, exact result and line', async () => {
    const cases = [
      ['conversation not found', { conversations: [null] }, 'conversation_not_found', ['warn', `${PREFIX}: skipped conversation_not_found`]],
      ['human takeover', { conversations: [conversation({ humanTakeover: true })] }, 'human_takeover', ['info', `${PREFIX_LEAD}: skipped human_takeover`]],
      ['no profile', { profile: null }, 'no_business_context', ['warn', `${PREFIX_LEAD}: skipped no_business_context (BUSINESS_CONTEXT_MISSING)`]],
      ['blank context', { profile: { ...PROFILE, context: '   ' } }, 'no_business_context', ['warn', `${PREFIX_LEAD}: skipped no_business_context (BUSINESS_CONTEXT_MISSING)`]],
      ['the newest message is from a team member', { messages: [MESSAGES[0], { ...MESSAGES[2], sender: 'HUMAN' }] }, 'nothing_to_answer', ['info', `${PREFIX_LEAD}: skipped nothing_to_answer`]],
      ['the only message is from the AI', { messages: [{ ...MESSAGES[2], sender: 'AI' }] }, 'nothing_to_answer', ['info', `${PREFIX_LEAD}: skipped nothing_to_answer`]],
    ];
    for (const [label, options, reason, line] of cases) {
      const { result, calls, lines } = await run(options);
      assert.deepEqual(result, { status: 'skipped', reason }, label);
      assert.deepEqual(lines, [line], label);
      for (const name of ['generateReply', 'createMessage', 'findLeadById', 'setAiSuggestion', 'setHumanTakeover']) {
        assert.ok(!names(calls).includes(name), `${label}: ${name} must not be called`);
      }
    }
  });

  test('a takeover switched on during the AI call: skipped after the AI, nothing sent, nothing written', async () => {
    const { result, calls, lines } = await run(SCENARIOS['takeover during the AI call']);
    assert.deepEqual(result, { status: 'skipped', reason: 'human_takeover_during_ai' });
    assert.deepEqual(names(calls), [
      'findConversationWithLead',
      'getBusinessProfile',
      'findLastMessagesByConversation',
      'generateReply',
      'findConversationWithLead',
    ]);
    assert.deepEqual(lines, [['info', `${PREFIX_LEAD}: skipped human_takeover_during_ai after gemini`]]);
  });

  test('during the AI call: a newer message is superseded, a deleted conversation is not found; neither sends', async () => {
    const superseded = await run({ ...SCENARIOS['superseded during the AI call'], reply: { ...REPLY, provider: 'groq' } });
    assert.deepEqual(superseded.result, { status: 'skipped', reason: 'superseded' });
    assert.deepEqual(names(superseded.calls).slice(3), ['generateReply', 'findConversationWithLead', 'findLastMessagesByConversation']);
    assert.deepEqual(superseded.lines, [['info', `${PREFIX_LEAD}: skipped superseded after groq`]]);

    const deleted = await run({ conversations: [conversation(), null] });
    assert.deepEqual(deleted.result, { status: 'skipped', reason: 'conversation_not_found' });
    assert.deepEqual(names(deleted.calls).slice(3), ['generateReply', 'findConversationWithLead']);
    assert.deepEqual(deleted.lines, [['warn', `${PREFIX_LEAD}: skipped conversation_not_found after gemini`]]);

    const noneLeft = await run({ newest: [] });
    assert.deepEqual(noneLeft.result, { status: 'skipped', reason: 'superseded' });
    assert.ok(!names(noneLeft.calls).includes('createMessage'));
  });
});

describe('replyToLead — sending', () => {
  test('each generateReply outcome is sent as the AI message; the fallback is sent, then the takeover is set', async () => {
    const groq = await run(SCENARIOS['replied via groq']);
    assert.deepEqual(groq.calls[6], ['createMessage', CONVERSATION_ID, { sender: 'AI', content: 'Reply marker 9006' }]);
    assert.deepEqual(groq.result, { status: 'replied', provider: 'groq', requiresHuman: true, suggestionSaved: true, errorCode: null });
    assert.deepEqual(groq.lines, [['info', `${PREFIX_LEAD}: replied via groq, suggestion INTERESTED saved, takeover set`]]);

    const fallback = await run(SCENARIOS['replied via the fallback']);
    assert.deepEqual(names(fallback.calls).slice(6), ['createMessage', 'setHumanTakeover']);
    assert.deepEqual(fallback.calls[6], ['createMessage', CONVERSATION_ID, { sender: 'AI', content: FALLBACK_REPLY }]);
    assert.deepEqual(fallback.calls[7], ['setHumanTakeover', CONVERSATION_ID, true]);
    assert.deepEqual(fallback.result, { status: 'replied', provider: 'fallback', requiresHuman: true, suggestionSaved: false, errorCode: 'TIMEOUT' });
    assert.deepEqual(fallback.lines, [['info', `${PREFIX_LEAD}: replied via fallback (TIMEOUT), takeover set`]]);
  });

  test('a failed send: send_failed with the code, no suggestion, takeover set only when requiresHuman', async () => {
    for (const [thrown, code] of SEND_FAILURES) {
      const { result, calls, lines } = await run({ send: fail(thrown) });
      assert.deepEqual(result, { status: 'send_failed', errorCode: code }, code);
      assert.deepEqual(names(calls).slice(6), ['createMessage', 'setHumanTakeover'], code);
      assert.deepEqual(lines, [['error', `${PREFIX_LEAD}: send_failed ${code} after gemini, takeover set`]], code);
    }

    const noHuman = await run(SCENARIOS['send failed, requiresHuman false']);
    assert.deepEqual(noHuman.result, { status: 'send_failed', errorCode: 'P1001' });
    assert.deepEqual(names(noHuman.calls).slice(6), ['createMessage']);
    assert.deepEqual(noHuman.lines, [['error', `${PREFIX_LEAD}: send_failed P1001 after gemini`]]);

    const takeoverFails = await run({ send: fail(SEND_FAILURES[2][0]), setTakeover: fail(LEAKY) });
    assert.deepEqual(takeoverFails.result, { status: 'send_failed', errorCode: 'TIMEOUT' });
    assert.deepEqual(takeoverFails.lines, [['error', `${PREFIX_LEAD}: send_failed TIMEOUT after gemini, takeover failed (P1001)`]]);
  });
});

describe('replyToLead — after the send', () => {
  test('the suggestion is saved only after the AI message, dropped when it equals the reloaded stage or the lead is gone, untouched when null', async () => {
    const saved = await run();
    const order = names(saved.calls);
    assert.ok(order.indexOf('createMessage') < order.indexOf('findLeadById'));
    assert.ok(order.indexOf('findLeadById') < order.indexOf('setAiSuggestion'));

    // The send moved the lead NEW -> CONTACTED, so a CONTACTED suggestion now equals the stage.
    const equal = await run({ reply: { ...REPLY, suggestedStage: 'CONTACTED' }, reloadedLead: { ...LEAD, stage: 'CONTACTED' } });
    assert.ok(!names(equal.calls).includes('setAiSuggestion'));
    assert.deepEqual(equal.result, { status: 'replied', provider: 'gemini', requiresHuman: true, suggestionSaved: false, errorCode: null });
    assert.deepEqual(equal.lines, [['info', `${PREFIX_LEAD}: replied via gemini, suggestion CONTACTED dropped (equals stage), takeover set`]]);

    const gone = await run({ reloadedLead: null });
    assert.ok(!names(gone.calls).includes('setAiSuggestion'));
    assert.equal(gone.result.suggestionSaved, false);
    assert.deepEqual(gone.lines, [['info', `${PREFIX_LEAD}: replied via gemini, suggestion INTERESTED dropped (lead not found), takeover set`]]);

    const none = await run({ reply: { ...REPLY, suggestedStage: null } });
    assert.ok(!names(none.calls).includes('findLeadById'));
    assert.ok(!names(none.calls).includes('setAiSuggestion'));
    assert.deepEqual(none.lines, [['info', `${PREFIX_LEAD}: replied via gemini, takeover set`]]);
  });

  test('a failed suggestion (write or lead reload) is logged and does not block the takeover', async () => {
    const write = await run(SCENARIOS['suggestion failed']);
    assert.deepEqual(names(write.calls).slice(7), ['findLeadById', 'setAiSuggestion', 'setHumanTakeover']);
    assert.deepEqual(write.result, { status: 'replied', provider: 'gemini', requiresHuman: true, suggestionSaved: false, errorCode: null });
    assert.deepEqual(write.lines, [['error', `${PREFIX_LEAD}: replied via gemini, suggestion INTERESTED failed (P1001), takeover set`]]);

    const reload = await run({ reloadedLead: fail(new OpenWAError('not this one', { status: 503 })) });
    assert.deepEqual(names(reload.calls).slice(7), ['findLeadById', 'setHumanTakeover']);
    assert.equal(reload.result.status, 'replied');
    assert.deepEqual(reload.lines, [['error', `${PREFIX_LEAD}: replied via gemini, suggestion INTERESTED failed (HTTP_503), takeover set`]]);
  });

  test('a failed takeover is logged and the result is still replied', async () => {
    const { result, lines } = await run(SCENARIOS['takeover failed']);
    assert.deepEqual(result, { status: 'replied', provider: 'gemini', requiresHuman: true, suggestionSaved: true, errorCode: null });
    assert.deepEqual(lines, [['error', `${PREFIX_LEAD}: replied via gemini, suggestion INTERESTED saved, takeover failed (P1001)`]]);
  });
});

describe('replyToLead — never throws, never leaks, never writes stage', () => {
  test('any unexpected failure before the send is the failed status with its step and code, and nothing is sent', async () => {
    const cases = [
      [{ conversations: [fail(LEAKY)] }, 'load_conversation', 'P1001', PREFIX],
      [{ profile: fail(LEAKY) }, 'load_context', 'P1001', PREFIX_LEAD],
      [{ messages: fail(LEAKY) }, 'load_context', 'P1001', PREFIX_LEAD],
      [{ messages: () => undefined }, 'load_context', 'TypeError', PREFIX_LEAD],
      [{ conversations: [conversation({ lead: { ...LEAD, stage: 'WON' } })] }, 'build_request', 'TypeError', PREFIX_LEAD],
      [{ reply: fail(LEAKY) }, 'generate_reply', 'P1001', PREFIX_LEAD],
      [{ reply: () => undefined }, 'generate_reply', 'TypeError', PREFIX_LEAD],
      [{ conversations: [conversation(), fail(LEAKY)] }, 'recheck', 'P1001', PREFIX_LEAD],
      [{ newest: fail(LEAKY) }, 'recheck', 'P1001', PREFIX_LEAD],
      [{ conversations: [fail('a thrown string')] }, 'load_conversation', 'UNEXPECTED', PREFIX],
      [{ profile: fail(undefined) }, 'load_context', 'UNEXPECTED', PREFIX_LEAD],
      [{ reply: fail(new OpenWAError('status only', { status: 502 })) }, 'generate_reply', 'HTTP_502', PREFIX_LEAD],
    ];
    for (const [options, step, errorCode, prefix] of cases) {
      const { result, calls, lines } = await run(options);
      assert.deepEqual(result, { status: 'failed', step, errorCode }, `${step} ${errorCode}`);
      assert.deepEqual(lines, [['error', `${prefix}: failed at ${step} (${errorCode})`]], `${step} ${errorCode}`);
      assert.ok(!names(calls).includes('createMessage'));
      assert.ok(!names(calls).includes('setHumanTakeover'));
    }
  });

  test('exactly one log line per call, and no line holds message text, the reply, the name or the phone number', async () => {
    for (const [label, options] of Object.entries(SCENARIOS)) {
      const { lines } = await run(options);
      assert.equal(lines.length, 1, `${label}: one line`);
      for (const leak of LEAKS) assert.ok(!lines[0][1].includes(leak), `${label}: log holds "${leak}"`);
      assert.ok(['info', 'warn', 'error'].includes(lines[0][0]));
    }
  });

  test('no lead stage writer is ever called, and the source never names one', async () => {
    for (const options of Object.values(SCENARIOS)) {
      const { writers } = await run(options);
      for (const writer of writers) assert.equal(writer.mock.callCount(), 0);
    }

    const file = path.join(__dirname, '../../src/application/useCases/replyToLead.useCase.js');
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(source.length > 0);
    for (const name of ['updateLeadStage', 'updateLeadInfo', 'updateLeadCampaign', 'stageChangeData', 'updateAiSuggestion']) {
      assert.ok(!source.includes(name), `replyToLead.useCase.js names ${name}`);
    }
  });

  test('no network in any scenario', async () => {
    for (const options of Object.values(SCENARIOS)) await run(options);
    assert.equal(fetchSpy.mock.callCount(), 0);
  });
});
