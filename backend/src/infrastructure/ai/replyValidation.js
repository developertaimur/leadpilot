const { LeadStage } = require('@prisma/client');

// Shared by the AI provider clients: the same request check and the same strict reply validation.
const STAGES = Object.values(LeadStage);
const MAX_REPLY_LENGTH = 4096;
const INVALID_RESPONSE = 'INVALID_RESPONSE';

const invalid = () => ({ error: INVALID_RESPONSE });

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A bad request is a caller bug: a plain TypeError whose message never holds any text from the request.
function assertReplyRequest(systemInstruction, messages) {
  const valid =
    typeof systemInstruction === 'string' &&
    systemInstruction.trim() !== '' &&
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.every(
      (m) => isPlainObject(m) && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim() !== '',
    );
  if (!valid) {
    throw new TypeError('generateStructuredReply needs a non-empty systemInstruction and messages as [{ role: "user" | "model", text }]');
  }
}

// A model's JSON text -> { value: { reply, suggestedStage, reason, requiresHuman } } when valid, or
// { error: 'INVALID_RESPONSE' } for anything else. Never throws; each client wraps the code in its own error.
function parseStructuredReply(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return invalid();
  }
  if (!isPlainObject(data)) return invalid();

  const { reply, suggestedStage, reason, requiresHuman } = data;
  if (typeof reply !== 'string' || reply.trim() === '' || reply.trim().length > MAX_REPLY_LENGTH) return invalid();
  if (suggestedStage !== null && !STAGES.includes(suggestedStage)) return invalid();
  if (typeof reason !== 'string' || typeof requiresHuman !== 'boolean') return invalid();

  return { value: { reply: reply.trim(), suggestedStage, reason: reason.trim(), requiresHuman } };
}

module.exports = { STAGES, MAX_REPLY_LENGTH, isPlainObject, assertReplyRequest, parseStructuredReply };
