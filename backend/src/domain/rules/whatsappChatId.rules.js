// WhatsApp chat id for a 1:1 chat: the E.164 digits without "+", plus "@c.us".
function toChatId(e164) {
  if (typeof e164 !== 'string' || !/^\+[1-9]\d{6,14}$/.test(e164)) {
    throw new Error('Phone number is not in E.164 format');
  }
  return `${e164.slice(1)}@c.us`;
}

module.exports = { toChatId };
