const env = require('../../config/env');
const replyToLeadUseCase = require('../useCases/replyToLead.useCase');

// Background AI replies to inbound WhatsApp messages, behind the AI_AUTO_REPLY_ENABLED switch.
// One in-memory queue per conversation: its jobs run one after another and never overlap (an older job ends
// as "superseded" through replyToLead's trigger check); different conversations run in parallel.
// Queues live in this process only and are lost on restart. replyToLead logs one line per job; the only
// lines written here are failure lines, holding a code and never message text, names, phones or message ids.

// conversationId -> the last job queued for it (the tail of that conversation's chain).
const queues = new Map();

const positiveInteger = (value) => Number.isInteger(value) && value > 0;

// Resolves on a later turn of the event loop, so a job never starts before its caller has finished.
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

// A code for a failure line, never an error message. Never throws, even for an error that cannot be read.
function codeOf(err) {
  try {
    if (typeof err?.code === 'string' && err.code !== '') return err.code;
    if (Number.isInteger(err?.status)) return `HTTP_${err.status}`;
    if (typeof err?.name === 'string' && err.name !== '') return err.name;
  } catch {
    // fall through
  }
  return 'UNEXPECTED';
}

// Logging must never become a failure of its own.
function logFailure(text) {
  try {
    console.error(text);
  } catch {
    // nothing more can be done
  }
}

// Queues an AI reply to a newly saved inbound message, to run in the background after the caller returns.
// Never throws and never rejects. Returns true when a job was queued; with the switch off it does nothing.
function scheduleReply(conversationId, triggerMessageId) {
  try {
    if (!env.aiAutoReplyEnabled) return false;
    if (!positiveInteger(conversationId) || !positiveInteger(triggerMessageId)) {
      logFailure('AI auto-reply: not scheduled (bad_request)');
      return false;
    }
    const previous = queues.get(conversationId) ?? Promise.resolve();
    const job = previous
      .then(nextTurn)
      .then(() => replyToLeadUseCase.replyToLead(conversationId, triggerMessageId))
      // replyToLead never rejects by contract; this only guards against a bug, so one failed job never
      // blocks the next one and never becomes an unhandled rejection.
      .catch((err) => logFailure(`AI auto-reply conversation ${conversationId}: job failed (${codeOf(err)})`))
      .finally(() => {
        // Only the last job of a conversation removes its entry, so an idle conversation leaves nothing behind.
        if (queues.get(conversationId) === job) queues.delete(conversationId);
      });
    queues.set(conversationId, job);
    return true;
  } catch (err) {
    logFailure(`AI auto-reply: not scheduled (${codeOf(err)})`);
    return false;
  }
}

// How many conversations have a job queued or running (for tests, and later a graceful shutdown).
function pendingConversations() {
  return queues.size;
}

// Settles once every queued job has finished, including jobs queued while waiting.
async function whenIdle() {
  while (queues.size > 0) await Promise.all([...queues.values()]);
}

module.exports = { scheduleReply, pendingConversations, whenIdle };
