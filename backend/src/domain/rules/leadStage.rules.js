// Any change of Lead.stage also clears the AI's stage suggestion, in the same update: a person (or the first
// outbound message) has acted on the lead, so the suggestion no longer applies.
function stageChangeData(stage) {
  return { stage, aiSuggestedStage: null, aiSuggestionReason: null };
}

module.exports = { stageChangeData };
