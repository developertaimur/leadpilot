const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LeadStage } = require('@prisma/client');
const { stageChangeData } = require('../../src/domain/rules/leadStage.rules');

test('stageChangeData sets the stage and clears both AI suggestion fields, as a new object each call', () => {
  for (const stage of Object.values(LeadStage)) {
    const data = stageChangeData(stage);
    assert.deepEqual(data, { stage, aiSuggestedStage: null, aiSuggestionReason: null });
    assert.deepEqual(Object.keys(data), ['stage', 'aiSuggestedStage', 'aiSuggestionReason']);
  }
  assert.notEqual(stageChangeData('LOST'), stageChangeData('LOST'), 'callers never share one object');
});
