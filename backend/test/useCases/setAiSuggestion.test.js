const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const leadRepository = require('../../src/infrastructure/database/lead.repository');
const { setAiSuggestion } = require('../../src/application/useCases/setAiSuggestion.useCase');

const SUGGESTIBLE = ['NEW', 'CONTACTED', 'INTERESTED', 'QUALIFIED', 'LOST'];
const SRC = path.join(__dirname, '../../src');

afterEach(() => mock.restoreAll());

function mockSuggestionWrite() {
  return mock.method(leadRepository, 'updateAiSuggestion', async (id, aiSuggestedStage, aiSuggestionReason) => ({
    id,
    aiSuggestedStage,
    aiSuggestionReason,
  }));
}
const argsOf = (fn) => fn.mock.calls.map((call) => call.arguments);

describe('setAiSuggestion', () => {
  test('writes both suggestion fields in one call, with the reason trimmed, for each stage the AI may suggest', async () => {
    const write = mockSuggestionWrite();
    for (const stage of SUGGESTIBLE) {
      const result = await setAiSuggestion(12, stage, '  Asked for a demo  ');
      assert.deepEqual(result, { id: 12, aiSuggestedStage: stage, aiSuggestionReason: 'Asked for a demo' });
    }
    assert.deepEqual(
      argsOf(write),
      SUGGESTIBLE.map((stage) => [12, stage, 'Asked for a demo']),
    );
  });

  test('an empty, whitespace-only, null or undefined reason is stored as null', async () => {
    const write = mockSuggestionWrite();
    for (const reason of ['', '   ', '\n\t ', null, undefined]) {
      await setAiSuggestion(12, 'QUALIFIED', reason);
    }
    await setAiSuggestion(12, 'QUALIFIED'); // reason left out
    assert.deepEqual(argsOf(write), Array.from({ length: 6 }, () => [12, 'QUALIFIED', null]));
  });

  test('bad input is a TypeError with one fixed message, and nothing is written', async () => {
    const write = mockSuggestionWrite();
    const bad = [
      ...['CONVERTED', null, undefined, '', 'qualified', 'WON', 42].map((stage) => [12, stage, 'Asked for a demo']),
      ...[42, {}, true, ['Asked for a demo']].map((reason) => [12, 'QUALIFIED', reason]),
      ...['5', 5.5, null, undefined, 0, -1, NaN, Infinity].map((leadId) => [leadId, 'QUALIFIED', 'Asked for a demo']),
    ];
    const messages = new Set();
    for (const args of bad) {
      await assert.rejects(setAiSuggestion(...args), (err) => {
        assert.ok(err instanceof TypeError, `expected a TypeError for ${String(args)}`);
        messages.add(err.message);
        return true;
      });
    }
    assert.equal(messages.size, 1, 'one fixed message');
    assert.equal(write.mock.callCount(), 0);
  });

  test('it never writes Lead.stage: only updateAiSuggestion runs, and the AI path sources never name a stage writer', async () => {
    const write = mockSuggestionWrite();
    const others = ['updateLeadStage', 'updateLeadInfo', 'updateLeadCampaign', 'createLead', 'deleteLead'].map((name) =>
      mock.method(leadRepository, name, async () => {
        throw new Error(`${name} must not be called`);
      }),
    );
    await setAiSuggestion(12, 'QUALIFIED', 'Asked for pricing');
    await setAiSuggestion(12, 'LOST', '');
    await assert.rejects(setAiSuggestion(12, 'CONVERTED', 'Paid'), TypeError);
    assert.equal(write.mock.callCount(), 2);
    for (const other of others) assert.equal(other.mock.callCount(), 0);

    // The raw source text, comments included, of every AI path file must not name any stage writer.
    const aiDir = path.join(SRC, 'application', 'ai');
    const aiFiles = fs.readdirSync(aiDir).filter((name) => name.endsWith('.js'));
    assert.ok(aiFiles.includes('contextBuilder.js') && aiFiles.includes('generateReply.js'), 'the scan covers the AI files');
    const files = [
      ...aiFiles.map((name) => path.join(aiDir, name)),
      path.join(SRC, 'application', 'useCases', 'setAiSuggestion.useCase.js'),
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      assert.ok(source.length > 0, `${file} is empty`);
      for (const name of ['updateLeadStage', 'updateLeadInfo', 'updateLeadCampaign', 'stageChangeData']) {
        assert.ok(!source.includes(name), `${path.relative(SRC, file)} names ${name}`);
      }
    }
  });
});
