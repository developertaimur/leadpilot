const crypto = require('node:crypto');

// Media saved as a placeholder (plus any caption), so the AI can ask the lead to type instead.
const MEDIA_PLACEHOLDERS = new Map([
  ['voice', '[voice note]'],
  ['audio', '[audio]'],
  ['image', '[image]'],
  ['video', '[video]'],
  ['document', '[document]'],
  ['sticker', '[sticker]'],
]);

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

// kind/type for log lines: OpenWA sends short enum words; anything else is not echoed.
function logToken(value) {
  return typeof value === 'string' && /^[\w.-]{1,32}$/.test(value) ? value : 'unknown';
}

// Message id safe for logs. whatsapp-web.js ids look like "false_<phone>@c.us_<hash>" (groups
// append "_<participant>"), so only the hash-like parts are kept: phone numbers never reach logs.
function logSafeId(id) {
  const parts = String(id)
    .split('_')
    .filter((part) => /^[A-Za-z0-9]{6,64}$/.test(part) && !/^\d+$/.test(part));
  return parts.join('_') || 'unknown';
}

// X-OpenWA-Signature is "sha256=" + hex HMAC-SHA256 of the raw request body.
function verifySignature(rawBody, signatureHeader, secret) {
  if (!rawBody || !secret || typeof signatureHeader !== 'string') return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const received = Buffer.from(signatureHeader);
  const wanted = Buffer.from(expected);
  return received.length === wanted.length && crypto.timingSafeEqual(received, wanted);
}

// Maps a verified OpenWA delivery. Returns null for events other than message.received,
// { ignored, whatsappMessageId, kind, type } for a message we do not save, or the lead
// message to save. Throws when the payload is malformed.
function parseIncoming(payload) {
  if (!isObject(payload) || typeof payload.event !== 'string') {
    throw new Error('Payload must be a JSON object with an event name');
  }
  if (payload.event !== 'message.received') return null;

  const { data } = payload;
  if (!isObject(data) || !nonEmptyString(data.id) || !nonEmptyString(data.chatId) || typeof data.type !== 'string') {
    throw new Error('message.received data must include id, chatId and type');
  }

  const ignore = (reason) => ({
    ignored: reason,
    whatsappMessageId: data.id,
    kind: logToken(data.kind),
    type: logToken(data.type),
  });
  if (data.fromMe) return ignore('own message');
  if (data.isGroup || data.kind !== 'individual') return ignore('not a 1:1 chat');

  const placeholder = MEDIA_PLACEHOLDERS.get(data.type);
  if (data.type !== 'text' && !placeholder) return ignore('unsupported type');

  const body = nonEmptyString(data.body);
  if (data.type === 'text' && !body) return ignore('empty text');
  const text = data.type === 'text' ? body : [placeholder, body?.trim()].filter(Boolean).join(' ');

  const contact = isObject(data.contact) ? data.contact : {};
  return {
    chatId: data.chatId,
    senderPhone: nonEmptyString(data.senderPhone),
    text,
    name: nonEmptyString(contact.pushName) ?? nonEmptyString(contact.name),
    whatsappMessageId: data.id,
  };
}

module.exports = { verifySignature, parseIncoming, logSafeId };
