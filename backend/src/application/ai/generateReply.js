const geminiClient = require('../../infrastructure/ai/gemini.client');
const groqClient = require('../../infrastructure/ai/groq.client');
const { STAGES } = require('../../infrastructure/ai/replyValidation');

// Provider manager: one AI reply for the Context Builder's request. Gemini first; Groq only when Gemini's quota
// is used up; a fixed fallback for every other failure. No retries, and it never throws for a provider failure.
// It does not build prompts, load data or send anything.
// The clients and their error classes are read from the module objects at call time, so tests can mock them.

const FALLBACK_REPLY = [
  'Thank you for your message. Our team will get back to you shortly.',
  'Aapke message ka shukriya. Hamari team jald hi aap se rabta karegi.',
].join('\n');

function fallbackResult(errorCode) {
  return {
    reply: FALLBACK_REPLY,
    suggestedStage: null,
    reason: 'AI unavailable',
    requiresHuman: true,
    provider: 'fallback',
    errorCode,
  };
}

// Only the four fields are taken. The schemas allow all six stages, so the stage rules are enforced here:
// CONVERTED is never suggested, and the lead's current stage is no suggestion. The reason is kept as is.
function providerResult({ reply, suggestedStage, reason, requiresHuman }, provider, currentStage) {
  const stage = suggestedStage === 'CONVERTED' || suggestedStage === currentStage ? null : suggestedStage;
  return { reply, suggestedStage: stage, reason, requiresHuman, provider, errorCode: null };
}

// Exactly one call: { value } when the client answers, { error } when it throws (at once or by rejecting).
async function attempt(client, request) {
  try {
    return { value: await client.generateStructuredReply(request) };
  } catch (error) {
    return { error };
  }
}

// The client's own error keeps its code; a TypeError is a bad request (a caller bug); anything else is
// unexpected. So only a real GeminiError can give Gemini's QUOTA.
function codeOf(error, ClientError) {
  if (error instanceof ClientError && typeof error.code === 'string') return error.code;
  if (error instanceof TypeError) return 'BAD_REQUEST';
  return 'UNEXPECTED';
}

// "gemini timeout", "groq api_error 503": the provider and its code, never an error message.
function failure(provider, code, error) {
  const status = code === 'API_ERROR' && Number.isInteger(error?.status) ? ` ${error.status}` : '';
  return `${provider} ${code.toLowerCase()}${status}`;
}

// request: the Context Builder's output { systemInstruction, messages }, passed to the clients unchanged.
// currentStage: the lead's stage now. Always resolves to
// { reply, suggestedStage, reason, requiresHuman, provider: 'gemini' | 'groq' | 'fallback', errorCode },
// with errorCode set only for the fallback. Rejects only for a bad currentStage, before any provider call.
async function generateReply({ request, currentStage } = {}) {
  if (!STAGES.includes(currentStage)) {
    throw new TypeError('generateReply needs currentStage to be one of the six lead stages');
  }

  const gemini = await attempt(geminiClient, request);
  if (!('error' in gemini)) return providerResult(gemini.value, 'gemini', currentStage);

  const geminiCode = codeOf(gemini.error, geminiClient.GeminiError);
  if (geminiCode !== 'QUOTA') {
    console.error(`AI reply: ${failure('gemini', geminiCode, gemini.error)}, used fallback`);
    return fallbackResult(geminiCode);
  }

  const groq = await attempt(groqClient, request);
  if (!('error' in groq)) {
    console.warn('AI reply: gemini quota, used groq');
    return providerResult(groq.value, 'groq', currentStage);
  }

  const groqCode = codeOf(groq.error, groqClient.GroqError);
  console.error(`AI reply: gemini quota, ${failure('groq', groqCode, groq.error)}, used fallback`);
  return fallbackResult(groqCode);
}

module.exports = { generateReply, FALLBACK_REPLY };
