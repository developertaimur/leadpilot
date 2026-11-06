const env = require('../../config/env');

const SEND_TIMEOUT_MS = 20000; // OpenWA's simulated typing alone can take ~5.75 s
const LOOKUP_TIMEOUT_MS = 10000;
const STATUS_TIMEOUT_MS = 10000;
const MAX_TEXT_LENGTH = 4096;

// Socket errors raised while resolving or connecting: the request never reached OpenWA.
const NOT_CONNECTED_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
]);

class OpenWAError extends Error {
  constructor(message, { status = null, code = null, retryAfterSeconds = null, neverConnected = false, cause } = {}) {
    super(message, { cause });
    this.name = 'OpenWAError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.neverConnected = neverConnected;
  }
}

// True only when fetch failed before a connection existed; false whenever it cannot tell.
function failedBeforeConnecting(fetchError) {
  const cause = fetchError?.cause;
  if (NOT_CONNECTED_CODES.has(cause?.code)) return true;
  const inner = Array.isArray(cause?.errors) ? cause.errors : [];
  return inner.length > 0 && inner.every((err) => NOT_CONNECTED_CODES.has(err?.code));
}

function sessionUrl(path) {
  const { openwaBaseUrl, openwaApiKey, openwaSessionId } = env;
  if (!openwaBaseUrl || !openwaApiKey || !openwaSessionId) {
    throw new OpenWAError('OpenWA is not configured (OPENWA_BASE_URL, OPENWA_API_KEY, OPENWA_SESSION_ID)', {
      code: 'NOT_CONFIGURED',
    });
  }
  return `${openwaBaseUrl.replace(/\/+$/, '')}/api/sessions/${encodeURIComponent(openwaSessionId)}${path}`;
}

async function request(method, path, body, timeoutMs) {
  const url = sessionUrl(path);

  // On TIMEOUT, or a 503 from OpenWA, a send may already have gone out. We throw without
  // saving the message, and callers must NOT auto-retry: a retry could send it twice.
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { 'X-API-Key': env.openwaApiKey, ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err.name === 'TimeoutError';
    throw new OpenWAError(timedOut ? `OpenWA did not answer within ${timeoutMs} ms` : 'OpenWA is unreachable', {
      code: timedOut ? 'TIMEOUT' : 'UNREACHABLE',
      neverConnected: !timedOut && failedBeforeConnecting(err),
      cause: err,
    });
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
    throw new OpenWAError(`OpenWA error ${response.status}: ${detail || response.statusText}`, {
      status: response.status,
      code: data?.code ?? null,
      retryAfterSeconds: data?.retryAfterSeconds ?? (Number(response.headers.get('retry-after')) || null),
    });
  }
  return data;
}

async function sendText(chatId, text) {
  if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH) {
    throw new OpenWAError(`Message text must be a string of at most ${MAX_TEXT_LENGTH} characters`, {
      code: 'INVALID_TEXT',
    });
  }
  const data = await request('POST', '/messages/send-text', { chatId, text }, SEND_TIMEOUT_MS);
  return { messageId: data?.messageId ?? null, timestamp: data?.timestamp ?? null };
}

// Phone digits for a contact id such as "<lid>@lid", or null when OpenWA cannot map it.
async function resolveLidPhone(contactId) {
  const data = await request('GET', `/contacts/${encodeURIComponent(contactId)}/phone`, undefined, LOOKUP_TIMEOUT_MS);
  return typeof data?.phone === 'string' && /^\d{7,15}$/.test(data.phone) ? data.phone : null;
}

// Status of the configured session from GET /api/sessions/{sessionId}. Returns only { status }, the
// lowercase word OpenWA reports (e.g. "ready", "qr_ready", "disconnected"); every other field is dropped.
async function getSessionStatus() {
  const data = await request('GET', '', undefined, STATUS_TIMEOUT_MS);
  if (typeof data?.status !== 'string' || !/^[a-z_]{1,32}$/.test(data.status)) {
    throw new OpenWAError('OpenWA returned no session status', { code: 'INVALID_RESPONSE' });
  }
  return { status: data.status };
}

module.exports = { sendText, resolveLidPhone, getSessionStatus, OpenWAError };
