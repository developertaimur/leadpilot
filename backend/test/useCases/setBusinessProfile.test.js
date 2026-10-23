const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const businessProfileRepository = require('../../src/infrastructure/database/businessProfile.repository');
const { setBusinessProfile } = require('../../src/application/useCases/setBusinessProfile.useCase');

const EXISTING = { id: 7, name: 'Gymfinity', context: 'Gym in Lahore', salesInstructions: null };

function mockRepository(existingRow) {
  return {
    get: mock.method(businessProfileRepository, 'getBusinessProfile', async () => existingRow),
    create: mock.method(businessProfileRepository, 'createBusinessProfile', async (data) => ({ id: 1, ...data })),
    update: mock.method(businessProfileRepository, 'updateBusinessProfile', async (id, data) => ({ ...EXISTING, id, ...data })),
  };
}

afterEach(() => mock.restoreAll());

describe('setBusinessProfile — existing profile (update path)', () => {
  test('1. only salesInstructions: trimmed, name/context untouched', async () => {
    const repo = mockRepository(EXISTING);
    await setBusinessProfile({ salesInstructions: '  Be concise  ' });
    assert.equal(repo.update.mock.callCount(), 1);
    assert.deepEqual(repo.update.mock.calls[0].arguments, [7, { salesInstructions: 'Be concise' }]);
    assert.equal(repo.create.mock.callCount(), 0);
  });

  test('2. only name: trimmed, other fields untouched', async () => {
    const repo = mockRepository(EXISTING);
    await setBusinessProfile({ name: ' Gymfinity ' });
    assert.deepEqual(repo.update.mock.calls[0].arguments, [7, { name: 'Gymfinity' }]);
  });

  test('3. salesInstructions: null clears the field', async () => {
    const repo = mockRepository(EXISTING);
    await setBusinessProfile({ salesInstructions: null });
    assert.deepEqual(repo.update.mock.calls[0].arguments, [7, { salesInstructions: null }]);
  });

  test('3b. empty or whitespace salesInstructions is stored as null', async () => {
    const repo = mockRepository(EXISTING);
    await setBusinessProfile({ salesInstructions: '' });
    await setBusinessProfile({ salesInstructions: '   ' });
    assert.deepEqual(repo.update.mock.calls[0].arguments, [7, { salesInstructions: null }]);
    assert.deepEqual(repo.update.mock.calls[1].arguments, [7, { salesInstructions: null }]);
  });

  test('4. empty body is rejected', async () => {
    const repo = mockRepository(EXISTING);
    await assert.rejects(setBusinessProfile({}), { message: 'Provide at least one of: name, context, salesInstructions' });
    assert.equal(repo.update.mock.callCount(), 0);
  });

  test('5. empty or whitespace name is rejected before any DB call', async () => {
    const repo = mockRepository(EXISTING);
    await assert.rejects(setBusinessProfile({ name: '' }), { message: 'name must be a non-empty string' });
    await assert.rejects(setBusinessProfile({ name: '   ' }), { message: 'name must be a non-empty string' });
    assert.equal(repo.get.mock.callCount(), 0);
    assert.equal(repo.update.mock.callCount(), 0);
  });

  test('6. null name or context is rejected', async () => {
    const repo = mockRepository(EXISTING);
    await assert.rejects(setBusinessProfile({ name: null }), { message: 'name must be a non-empty string' });
    await assert.rejects(setBusinessProfile({ context: null }), { message: 'context must be a non-empty string' });
    assert.equal(repo.update.mock.callCount(), 0);
  });

  test('7. non-string context is rejected', async () => {
    const repo = mockRepository(EXISTING);
    await assert.rejects(setBusinessProfile({ context: 123 }), { message: 'context must be a non-empty string' });
    assert.equal(repo.update.mock.callCount(), 0);
  });

  test('8. non-string, non-null salesInstructions is rejected', async () => {
    const repo = mockRepository(EXISTING);
    await assert.rejects(setBusinessProfile({ salesInstructions: 42 }), {
      message: 'salesInstructions must be a string or null',
    });
    assert.equal(repo.update.mock.callCount(), 0);
  });
});

describe('setBusinessProfile — no profile yet (create path)', () => {
  test('9. missing name or context is rejected', async () => {
    const repo = mockRepository(null);
    await assert.rejects(setBusinessProfile({ context: 'x' }), {
      message: 'name and context are required to create the business profile',
    });
    await assert.rejects(setBusinessProfile({ name: 'x' }), {
      message: 'name and context are required to create the business profile',
    });
    assert.equal(repo.create.mock.callCount(), 0);
  });

  test('10. creates with trimmed name, context and salesInstructions', async () => {
    const repo = mockRepository(null);
    const result = await setBusinessProfile({ name: ' A ', context: ' B ', salesInstructions: ' C ' });
    assert.deepEqual(repo.create.mock.calls[0].arguments, [{ name: 'A', context: 'B', salesInstructions: 'C' }]);
    assert.deepEqual(result, { id: 1, name: 'A', context: 'B', salesInstructions: 'C' });
    assert.equal(repo.update.mock.callCount(), 0);
  });

  test('11. creates without salesInstructions when it is omitted', async () => {
    const repo = mockRepository(null);
    await setBusinessProfile({ name: 'A', context: 'B' });
    assert.deepEqual(repo.create.mock.calls[0].arguments, [{ name: 'A', context: 'B' }]);
  });
});
