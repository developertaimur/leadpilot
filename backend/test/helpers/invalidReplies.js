// Model outputs (the raw JSON text a provider returns) for the shared reply validation.
const VALID_REPLY = {
  reply: '  Great, 150 members! Would a free 7-day demo help?  ',
  suggestedStage: 'INTERESTED',
  reason: '  Shared the gym size  ',
  requiresHuman: false,
};

const asText = (payload) => JSON.stringify(payload);

// Each must be rejected as INVALID_RESPONSE, whatever provider returned it.
const INVALID_REPLY_TEXTS = {
  'not JSON': 'Sure! Here is my reply.',
  'empty text': '',
  'a JSON array': asText([VALID_REPLY]),
  'JSON null': 'null',
  'reply empty': asText({ ...VALID_REPLY, reply: '' }),
  'reply only whitespace': asText({ ...VALID_REPLY, reply: '   ' }),
  'reply over 4096 characters': asText({ ...VALID_REPLY, reply: 'x'.repeat(4097) }),
  'reply not a string': asText({ ...VALID_REPLY, reply: 42 }),
  'stage not a known stage': asText({ ...VALID_REPLY, suggestedStage: 'WON' }),
  'stage in lowercase': asText({ ...VALID_REPLY, suggestedStage: 'new' }),
  'stage a number': asText({ ...VALID_REPLY, suggestedStage: 3 }),
  'reason not a string': asText({ ...VALID_REPLY, reason: null }),
  'requiresHuman as the string "true"': asText({ ...VALID_REPLY, requiresHuman: 'true' }),
  'reply missing': asText({ suggestedStage: null, reason: '', requiresHuman: false }),
  'suggestedStage missing': asText({ reply: 'Hi', reason: '', requiresHuman: false }),
  'reason missing': asText({ reply: 'Hi', suggestedStage: null, requiresHuman: false }),
  'requiresHuman missing': asText({ reply: 'Hi', suggestedStage: null, reason: '' }),
};

module.exports = { VALID_REPLY, INVALID_REPLY_TEXTS };
