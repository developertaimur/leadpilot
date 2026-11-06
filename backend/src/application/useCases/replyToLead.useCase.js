const conversationRepository = require('../../infrastructure/database/conversation.repository');
const businessProfileRepository = require('../../infrastructure/database/businessProfile.repository');
const messageRepository = require('../../infrastructure/database/message.repository');
const leadRepository = require('../../infrastructure/database/lead.repository');
const createMessageUseCase = require('./createMessage.useCase');
const setAiSuggestionUseCase = require('./setAiSuggestion.useCase');
const setHumanTakeoverUseCase = require('./setHumanTakeover.useCase');
const generateReplyModule = require('../ai/generateReply');
const { buildAiRequest, HISTORY_LIMIT } = require('../ai/contextBuilder');

// The AI reply pipeline for one inbound message, already saved as triggerMessageId. Never throws: every
// outcome is a returned { status, ... }. One log line per call, holding ids and codes only.
// Lead.stage is never written here: the NEW -> CONTACTED move happens inside createMessage, and the AI's
// stage suggestion is saved only through the setAiSuggestion use case.
// Every dependency is called through its module object at call time, so tests can mock it.

const positiveInteger = (value) => Number.isInteger(value) && value > 0;

// A code for the log line and the result, never an error message.
function codeOf(err) {
  if (typeof err?.code === 'string' && err.code !== '') return err.code;
  if (Number.isInteger(err?.status)) return `HTTP_${err.status}`;
  if (typeof err?.name === 'string' && err.name !== '') return err.name;
  return 'UNEXPECTED';
}

function log(run, method, text) {
  const lead = run.leadId === null ? '' : ` lead ${run.leadId}`;
  console[method](`AI pipeline conversation ${run.conversationId}${lead}: ${text}`);
}

function skip(run, method, reason, detail = '') {
  log(run, method, `skipped ${reason}${detail ? ` ${detail}` : ''}`);
  return { done: { status: 'skipped', reason } };
}

// Steps 1-5: everything before the send. Returns { done } for a skip, or { result, after } to go on.
// Throws only for unexpected failures, which replyToLead turns into the 'failed' status.
async function prepare(run, triggerMessageId) {
  run.step = 'load_conversation';
  const conversation = await conversationRepository.findConversationWithLead(run.conversationId);
  if (!conversation) return skip(run, 'warn', 'conversation_not_found');
  run.leadId = conversation.leadId;
  if (conversation.humanTakeover) return skip(run, 'info', 'human_takeover');

  run.step = 'load_context';
  const businessProfile = await businessProfileRepository.getBusinessProfile();
  const messages = await messageRepository.findLastMessagesByConversation(run.conversationId, HISTORY_LIMIT);
  // Only the run for the newest message calls the AI; a run for an older message would answer twice.
  if ((messages.at(-1)?.id ?? null) !== triggerMessageId) return skip(run, 'info', 'superseded', 'before ai');

  run.step = 'build_request';
  let request;
  try {
    request = buildAiRequest({ businessProfile, messages, lead: conversation.lead });
  } catch (err) {
    if (err?.code === 'BUSINESS_CONTEXT_MISSING') {
      return skip(run, 'warn', 'no_business_context', '(BUSINESS_CONTEXT_MISSING)');
    }
    throw err;
  }
  if (request === null) return skip(run, 'info', 'nothing_to_answer');

  run.step = 'generate_reply';
  const result = await generateReplyModule.generateReply({ request, currentStage: conversation.lead.stage });
  const after = `after ${result.provider}`;

  // Re-read fresh before sending: a person may have taken over, or a newer message may have arrived,
  // while the AI was answering. A later run answers the newer message.
  run.step = 'recheck';
  const fresh = await conversationRepository.findConversationWithLead(run.conversationId);
  if (!fresh) return skip(run, 'warn', 'conversation_not_found', after);
  if (fresh.humanTakeover) return skip(run, 'info', 'human_takeover_during_ai', after);
  const [newest] = await messageRepository.findLastMessagesByConversation(run.conversationId, 1);
  if ((newest?.id ?? null) !== triggerMessageId) return skip(run, 'info', 'superseded', after);

  return { result, after };
}

// Step 7: the suggestion, read against the lead as it is now (the send may have moved it NEW -> CONTACTED,
// which clears suggestions). A suggestion equal to the current stage is no suggestion.
async function saveSuggestion(run, { suggestedStage, reason }) {
  try {
    const lead = await leadRepository.findLeadById(run.leadId);
    if (!lead) return { text: `suggestion ${suggestedStage} dropped (lead not found)`, saved: false, failed: false };
    if (lead.stage === suggestedStage) {
      return { text: `suggestion ${suggestedStage} dropped (equals stage)`, saved: false, failed: false };
    }
    await setAiSuggestionUseCase.setAiSuggestion(run.leadId, suggestedStage, reason);
    return { text: `suggestion ${suggestedStage} saved`, saved: true, failed: false };
  } catch (err) {
    return { text: `suggestion ${suggestedStage} failed (${codeOf(err)})`, saved: false, failed: true };
  }
}

// Step 8: the same path staff use, so a takeover set by the AI behaves exactly like one set by a person.
async function setTakeover(run) {
  try {
    await setHumanTakeoverUseCase.setHumanTakeover(run.conversationId, true);
    return { text: 'takeover set', failed: false };
  } catch (err) {
    return { text: `takeover failed (${codeOf(err)})`, failed: true };
  }
}

// conversationId: the conversation to answer. triggerMessageId: the inbound message that started this run.
// Resolves to one of:
//   { status: 'skipped', reason }                                   nothing to do
//   { status: 'send_failed', errorCode }                            the reply could not be sent
//   { status: 'replied', provider, requiresHuman, suggestionSaved, errorCode }   errorCode only for the fallback
//   { status: 'failed', step, errorCode }                           an unexpected error, or a bad id
async function replyToLead(conversationId, triggerMessageId) {
  if (!positiveInteger(conversationId) || !positiveInteger(triggerMessageId)) {
    console.error('AI pipeline: failed bad_request');
    return { status: 'failed', step: 'input', errorCode: 'BAD_REQUEST' };
  }
  const run = { conversationId, leadId: null, step: 'load_conversation' };

  let prepared;
  try {
    prepared = await prepare(run, triggerMessageId);
  } catch (err) {
    const errorCode = codeOf(err);
    log(run, 'error', `failed at ${run.step} (${errorCode})`);
    return { status: 'failed', step: run.step, errorCode };
  }
  if (prepared.done) return prepared.done;
  const { result, after } = prepared;

  // 6. Send and save. If the AI asked for a person, the conversation is handed over even when the send
  // failed: the lead's message is unanswered, and the AI must stay out of a chat it flagged.
  try {
    await createMessageUseCase.createMessage(conversationId, { sender: 'AI', content: result.reply });
  } catch (err) {
    const errorCode = codeOf(err);
    const parts = [`send_failed ${errorCode} ${after}`];
    if (result.requiresHuman) parts.push((await setTakeover(run)).text);
    log(run, 'error', parts.join(', '));
    return { status: 'send_failed', errorCode };
  }

  // 7 and 8, only after the AI message is saved; a failure in either is logged, never thrown.
  const parts = [`replied via ${result.provider}${result.errorCode ? ` (${result.errorCode})` : ''}`];
  let failed = false;
  let suggestionSaved = false;
  if (result.suggestedStage !== null) {
    const suggestion = await saveSuggestion(run, result);
    parts.push(suggestion.text);
    suggestionSaved = suggestion.saved;
    failed = suggestion.failed;
  }
  if (result.requiresHuman) {
    const takeover = await setTakeover(run);
    parts.push(takeover.text);
    failed = failed || takeover.failed;
  }
  log(run, failed ? 'error' : 'info', parts.join(', '));
  return {
    status: 'replied',
    provider: result.provider,
    requiresHuman: result.requiresHuman,
    suggestionSaved,
    errorCode: result.errorCode,
  };
}

module.exports = { replyToLead };
