const leadRepository = require('../../infrastructure/database/lead.repository');
const { LeadStage } = require('@prisma/client');

// Every stage except CONVERTED: only a person marks a lead as converted.
const SUGGESTIBLE_STAGES = Object.values(LeadStage).filter((stage) => stage !== 'CONVERTED');

// Saves the AI's stage suggestion: both fields in one update, the reason trimmed (empty -> null).
// Never writes Lead.stage. The pipeline calls it only when suggestedStage is not null; bad input is a caller bug.
async function setAiSuggestion(leadId, stage, reason) {
  const valid =
    Number.isInteger(leadId) &&
    leadId > 0 &&
    SUGGESTIBLE_STAGES.includes(stage) &&
    (reason == null || typeof reason === 'string');
  if (!valid) {
    throw new TypeError(
      'setAiSuggestion needs a positive integer lead id, a stage other than CONVERTED, and a reason string or null',
    );
  }
  return leadRepository.updateAiSuggestion(leadId, stage, reason?.trim() || null);
}

module.exports = { setAiSuggestion };
