const Groq = require('groq-sdk');
const env = require('../../config/env');
const { failedBeforeConnecting } = require('../http/connectionErrors');
const { STAGES, assertReplyRequest, parseStructuredReply } = require('./replyValidation');

const { APIError, APIConnectionError, APIConnectionTimeoutError } = Groq;

const MODEL = 'openai/gpt-oss-20b';
const BASE_URL = 'https://api.groq.com';
const TIMEOUT_MS = 20000;
const MAX_COMPLETION_TOKENS = 2048; // reasoning tokens count toward this limit too

// Strict mode (constrained decoding) needs every property required and additionalProperties false.
const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    suggestedStage: { anyOf: [{ type: 'string', enum: STAGES }, { type: 'null' }] },
    reason: { type: 'string' },
    requiresHuman: { type: 'boolean' },
  },
  required: ['reply', 'suggestedStage', 'reason', 'requiresHuman'],
  additionalProperties: false,
};

// Fixed messages only: never the API key, message text, lead data or the model's output.
class GroqError extends Error {
  constructor(code, message, { status = null } = {}) {
    super(message);
    this.name = 'GroqError';
    this.code = code; // QUOTA | TIMEOUT | NOT_CONFIGURED | INVALID_RESPONSE | UNREACHABLE | API_ERROR
    this.status = status;
  }
}

// Checked in the order the SDK's error classes nest: timeout, then connection, then HTTP status.
function toGroqError(err) {
  if (err instanceof APIConnectionTimeoutError) {
    return new GroqError('TIMEOUT', `Groq did not answer within ${TIMEOUT_MS} ms`);
  }
  if (err instanceof APIConnectionError) {
    return failedBeforeConnecting(err.cause)
      ? new GroqError('UNREACHABLE', 'Groq is unreachable')
      : new GroqError('API_ERROR', 'Groq request failed');
  }
  if (err instanceof APIError && typeof err.status === 'number') {
    if (err.status === 429) return new GroqError('QUOTA', 'Groq quota exhausted', { status: 429 });
    return new GroqError('API_ERROR', `Groq API error ${err.status}`, { status: err.status });
  }
  return new GroqError('API_ERROR', 'Groq request failed');
}

// One Groq call: messages ([{ role: 'user' | 'model', text }]) under systemInstruction, answered as
// JSON matching RESPONSE_JSON_SCHEMA. Returns { reply, suggestedStage, reason, requiresHuman }, validated.
async function generateStructuredReply({ systemInstruction, messages } = {}) {
  if (!env.groqApiKey) throw new GroqError('NOT_CONFIGURED', 'Groq is not configured (GROQ_API_KEY)');
  assertReplyRequest(systemInstruction, messages);

  // Explicit apiKey, baseURL and logLevel, so GROQ_API_KEY, GROQ_BASE_URL and GROQ_LOG can never apply.
  // maxRetries 0: the SDK otherwise retries twice. Created per call, so it uses the current global fetch.
  const client = new Groq({
    apiKey: env.groqApiKey,
    baseURL: BASE_URL,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
    logLevel: 'off',
  });

  let completion;
  try {
    completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemInstruction },
        ...messages.map(({ role, text }) => ({ role: role === 'model' ? 'assistant' : 'user', content: text })),
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'lead_reply', strict: true, schema: RESPONSE_JSON_SCHEMA },
      },
      reasoning_effort: 'low',
      max_completion_tokens: MAX_COMPLETION_TOKENS,
    });
  } catch (err) {
    throw toGroqError(err);
  }

  // Only the message content is read; a `reasoning` field, if present, is ignored.
  const { value, error } = parseStructuredReply(completion?.choices?.[0]?.message?.content ?? '');
  if (error) throw new GroqError(error, 'Groq returned an invalid reply');
  return value;
}

module.exports = { generateStructuredReply, GroqError };
