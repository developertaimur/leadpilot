const { parsePhoneNumberFromString } = require('libphonenumber-js');

function normalizePhoneNumber(rawInput, defaultRegion) {
  if (!rawInput || !rawInput.trim()) {
    return { valid: false, reason: 'Phone number is empty' };
  }

  const phoneNumber = parsePhoneNumberFromString(rawInput.trim(), defaultRegion || undefined);

  if (!phoneNumber || !phoneNumber.isValid()) {
    return { valid: false, reason: 'Not a valid phone number' };
  }

  return { valid: true, e164: phoneNumber.number };
}

module.exports = { normalizePhoneNumber };