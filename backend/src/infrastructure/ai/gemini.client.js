const { GoogleGenAI, ApiError, Type } = require('@google/genai');
const env = require('../../config/env');
const { failedBeforeConnecting } = require('../http/connectionErrors');
const { STAGES, assertReplyRequest, parseStructuredReply } = require('./replyValidation');

const MODEL = 'gemini-3.5-flash';
const BASE_URL = 'https://generativelanguage.googleapis.com/';
const TIMEOUT_MS = 20000;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    suggestedStage: { type: Type.STRING, enum: STAGES, nullable: true },
    reason: { type: Type.STRING },
    requiresHuman: { type: Type.BOOLEAN },
  },
  required: ['reply', 'suggestedStage', 'reason', 'requiresHuman'],
  propertyOrdering: ['reply', 'suggestedStage', 'reason', 'requiresHuman'],
};

// Fixed messages only: never the API key, message text, lead data or the model's output.
class GeminiError extends Error {
  constructor(code, message, { status = null } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.code = code; // QUOTA | TIMEOUT | NOT_CONFIGURED | INVALID_RESPONSE | UNREACHABLE | API_ERROR
    this.status = status;
  }
}

// The status word ("RESOURCE_EXHAUSTED", "UNAVAILABLE", ...) of the JSON error body the SDK puts in ApiError.message.
function errorBodyStatus(apiError) {
  try {
    return JSON.parse(apiError.message)?.error?.status ?? null;
  } catch {
    return null;
  }
}

function toGeminiError(err) {
  if (err instanceof ApiError) {
    if (err.status === 429 || errorBodyStatus(err) === 'RESOURCE_EXHAUSTED') {
      return new GeminiError('QUOTA', 'Gemini quota exhausted', { status: err.status });
    }
    return new GeminiError('API_ERROR', `Gemini API error ${err.status}`, { status: err.status });
  }
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return new GeminiError('TIMEOUT', `Gemini did not answer within ${TIMEOUT_MS} ms`);
  }
  if (failedBeforeConnecting(err)) return new GeminiError('UNREACHABLE', 'Gemini is unreachable');
  return new GeminiError('API_ERROR', 'Gemini request failed');
}

// Reads the first candidate's text parts directly (skipping "thought" parts), so the SDK's
// response.text getter never logs; the shared module then validates the four fields strictly.
function parseReply(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.filter((part) => !part?.thought && typeof part?.text === 'string').map((part) => part.text).join('')
    : '';

  const { value, error } = parseStructuredReply(text);
  if (error) throw new GeminiError(error, 'Gemini returned an invalid reply');
  return value;
}

// One Gemini call: messages ([{ role: 'user' | 'model', text }]) under systemInstruction, answered as
// JSON matching RESPONSE_SCHEMA. Returns { reply, suggestedStage, reason, requiresHuman }, validated.
// The SDK retries only when given retryOptions; none are passed, so there is exactly one attempt.
async function generateStructuredReply({ systemInstruction, messages } = {}) {
  if (!env.geminiApiKey) throw new GeminiError('NOT_CONFIGURED', 'Gemini is not configured (GEMINI_API_KEY)');
  assertReplyRequest(systemInstruction, messages);

  // Explicit apiKey, vertexai and baseUrl, so the SDK's own environment variables can never apply.
  const ai = new GoogleGenAI({
    apiKey: env.geminiApiKey,
    vertexai: false,
    httpOptions: { baseUrl: BASE_URL, timeout: TIMEOUT_MS },
  });

  let response;
  try {
    response = await ai.models.generateContent({
      model: MODEL,
      contents: messages.map(({ role, text }) => ({ role, parts: [{ text }] })),
      config: { systemInstruction, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    });
  } catch (err) {
    throw toGeminiError(err);
  }
  return parseReply(response);
}

module.exports = { generateStructuredReply, GeminiError };
