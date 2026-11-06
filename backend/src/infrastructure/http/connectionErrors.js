// Socket errors raised while resolving or connecting: the request never reached the server.
const NOT_CONNECTED_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
]);

// True only when fetch failed before a connection existed; false whenever it cannot tell.
function failedBeforeConnecting(fetchError) {
  const cause = fetchError?.cause;
  if (NOT_CONNECTED_CODES.has(cause?.code)) return true;
  const inner = Array.isArray(cause?.errors) ? cause.errors : [];
  return inner.length > 0 && inner.every((err) => NOT_CONNECTED_CODES.has(err?.code));
}

module.exports = { NOT_CONNECTED_CODES, failedBeforeConnecting };
