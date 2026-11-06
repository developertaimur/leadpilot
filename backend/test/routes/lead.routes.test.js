const { test, describe, before, after, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/startApp');
const leadRepository = require('../../src/infrastructure/database/lead.repository');
const leadRoutes = require('../../src/api/routes/lead.routes');

const STAGES = ['NEW', 'CONTACTED', 'INTERESTED', 'QUALIFIED', 'CONVERTED', 'LOST'];
const STAGE_ERROR = 'Invalid stage filter. Must be one of: NEW, CONTACTED, INTERESTED, QUALIFIED, CONVERTED, LOST';
const AI_STAGE_ERROR =
  'Invalid aiSuggestedStage filter. Must be one of: NEW, CONTACTED, INTERESTED, QUALIFIED, CONVERTED, LOST';
const NO_FILTERS = { stage: undefined, source: undefined, channel: undefined, aiSuggestedStage: undefined };

// Fake rows, returned as they are by the mocked repository.
const ROWS = [
  {
    id: 31,
    name: 'Fake Lead',
    stage: 'CONTACTED',
    source: 'whatsapp_inbound',
    campaignId: null,
    aiSuggestedStage: 'QUALIFIED',
    aiSuggestionReason: 'Asked for pricing',
  },
];

let app;
before(async () => {
  app = await startApp(leadRoutes);
});
after(() => app.close());
afterEach(() => mock.restoreAll());

// GET /api/leads with a raw query string. Returns the status, the JSON body and the filters findAllLeads got.
async function getLeads(query) {
  const findAll = mock.method(leadRepository, 'findAllLeads', async () => ROWS);
  try {
    const res = await fetch(`${app.baseUrl}/api/leads${query ? `?${query}` : ''}`);
    return { status: res.status, body: await res.json(), calls: findAll.mock.calls.map((call) => call.arguments) };
  } finally {
    findAll.mock.restore();
  }
}

describe('GET /api/leads — aiSuggestedStage filter', () => {
  test('without aiSuggestedStage: 200 with the rows, and stage, source and channel reach the repository as before', async () => {
    const cases = [
      ['', {}],
      ['aiSuggestedStage=', { aiSuggestedStage: '' }],
      ['stage=', { stage: '' }],
      ['stage=QUALIFIED', { stage: 'QUALIFIED' }],
      ['source=whatsapp_inbound', { source: 'whatsapp_inbound' }],
      ['channel=outbound', { channel: 'outbound' }],
      ['channel=inbound', { channel: 'inbound' }],
      ['stage=LOST&source=Google%20Sheet&channel=outbound', { stage: 'LOST', source: 'Google Sheet', channel: 'outbound' }],
    ];
    for (const [query, given] of cases) {
      const { status, body, calls } = await getLeads(query);
      assert.equal(status, 200, query);
      assert.deepEqual(body, ROWS, query);
      assert.deepEqual(calls, [[{ ...NO_FILTERS, ...given }]], query);
    }
  });

  test('each of the six stages as aiSuggestedStage reaches the repository, also combined with the other filters', async () => {
    for (const stage of STAGES) {
      const { status, body, calls } = await getLeads(`aiSuggestedStage=${stage}`);
      assert.equal(status, 200, stage);
      assert.deepEqual(body, ROWS);
      assert.deepEqual(calls, [[{ ...NO_FILTERS, aiSuggestedStage: stage }]], stage);
    }

    const combined = await getLeads('stage=CONTACTED&source=whatsapp_inbound&channel=inbound&aiSuggestedStage=QUALIFIED');
    assert.equal(combined.status, 200);
    assert.deepEqual(combined.body, ROWS);
    assert.deepEqual(combined.calls, [
      [{ stage: 'CONTACTED', source: 'whatsapp_inbound', channel: 'inbound', aiSuggestedStage: 'QUALIFIED' }],
    ]);
  });

  test('an invalid aiSuggestedStage is 400 with the fixed message and no repository call; an invalid stage keeps its own message', async () => {
    const badSuggestion = [
      'aiSuggestedStage=qualified',
      'aiSuggestedStage=WON',
      'aiSuggestedStage=QUALIFIED&aiSuggestedStage=LOST', // repeated: an array
      'stage=NEW&source=whatsapp_inbound&aiSuggestedStage=Qualified',
    ];
    for (const query of badSuggestion) {
      const { status, body, calls } = await getLeads(query);
      assert.equal(status, 400, query);
      assert.deepEqual(body, { error: AI_STAGE_ERROR }, query);
      assert.equal(calls.length, 0, query);
    }

    // The existing stage check is unchanged, and it still runs first.
    for (const query of ['stage=qualified', 'stage=WON', 'stage=WON&aiSuggestedStage=QUALIFIED', 'stage=WON&aiSuggestedStage=WON']) {
      const { status, body, calls } = await getLeads(query);
      assert.equal(status, 400, query);
      assert.deepEqual(body, { error: STAGE_ERROR }, query);
      assert.equal(calls.length, 0, query);
    }
  });
});
