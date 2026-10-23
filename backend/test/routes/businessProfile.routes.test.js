const { test, describe, before, after, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/startApp');
const businessProfileRepository = require('../../src/infrastructure/database/businessProfile.repository');
const businessProfileRoutes = require('../../src/api/routes/businessProfile.routes');

const EXISTING = { id: 7, name: 'Gymfinity', context: 'Gym in Lahore', salesInstructions: 'Be concise' };

let app;
before(async () => { app = await startApp(businessProfileRoutes); });
after(() => app.close());
afterEach(() => mock.restoreAll());

function put(body) {
  return fetch(`${app.baseUrl}/api/business-profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('PUT /api/business-profile', () => {
  test('partial update returns 200 with the updated row', async () => {
    mock.method(businessProfileRepository, 'getBusinessProfile', async () => EXISTING);
    mock.method(businessProfileRepository, 'updateBusinessProfile', async (id, data) => ({ ...EXISTING, id, ...data }));
    const res = await put({ salesInstructions: 'Ask about goals' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ...EXISTING, salesInstructions: 'Ask about goals' });
  });

  test('validation error returns 400 with the message', async () => {
    const res = await put({ name: '' });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'name must be a non-empty string' });
  });

  test('no body returns 400', async () => {
    mock.method(businessProfileRepository, 'getBusinessProfile', async () => EXISTING);
    const res = await put(undefined);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Provide at least one of: name, context, salesInstructions' });
  });
});

describe('GET /api/business-profile', () => {
  test('returns 200 with salesInstructions', async () => {
    mock.method(businessProfileRepository, 'getBusinessProfile', async () => EXISTING);
    const res = await fetch(`${app.baseUrl}/api/business-profile`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).salesInstructions, 'Be concise');
  });

  test('returns 404 when no profile exists', async () => {
    mock.method(businessProfileRepository, 'getBusinessProfile', async () => null);
    const res = await fetch(`${app.baseUrl}/api/business-profile`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'No business profile set yet' });
  });
});
