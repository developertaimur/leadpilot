function parseIncomingMessage(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;

  if (!value || !value.messages || value.messages.length === 0) {
    return null;
  }

  const message = value.messages[0];

  if (message.type !== 'text') {
    return null;
  }

  const contact = value.contacts?.[0];

  return {
    phoneNumber: message.from,
    text: message.text.body,
    name: contact?.profile?.name || null,
  };
}

module.exports = { parseIncomingMessage };