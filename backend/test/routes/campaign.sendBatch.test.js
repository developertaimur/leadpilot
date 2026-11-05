const { test, before, after, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/startApp');
const sendBatchUseCase = require('../../src/application/useCases/sendBatch.useCase');
const campaignRoutes = require('../../src/api/routes/campaign.routes');

let app;
before(async () => {
  app = await startApp(campaignRoutes);
});
after(() => app.close());
afterEach(() => mock.restoreAll());

function post(id, body) {
  return fetch(`${app.baseUrl}/api/campaigns/${id}/send-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('202 with campaignId, queued and remaining; the background promise is not part of the body', async () => {
  const sendBatch = mock.method(sendBatchUseCase, 'sendBatch', async () => ({
    campaignId: 3,
    queued: 2,
    remaining: 5,
    done: Promise.resolve(null),
  }));

  const res = await post(3, { count: 2 });

  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { campaignId: 3, queued: 2, remaining: 5 });
  assert.deepEqual(sendBatch.mock.calls[0].arguments, [3, 2]);
});

test('errors map to 404, 409, 429 and 400', async () => {
  const cases = [
    ['Campaign not found', 404],
    ['A batch is already running', 409],
    ['First-contact limit for the last 24 hours reached', 429],
    ['count must be a positive whole number', 400],
    ['Campaign is paused. Activate it before sending.', 400],
  ];
  for (const [message, status] of cases) {
    mock.method(sendBatchUseCase, 'sendBatch', async () => {
      throw new Error(message);
    });
    const res = await post(3, { count: 1 });
    assert.equal(res.status, status, message);
    assert.deepEqual(await res.json(), { error: message });
    mock.restoreAll();
  }
});
