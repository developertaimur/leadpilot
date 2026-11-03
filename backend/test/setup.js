// Loaded with --require before every test file. Blocks any fetch to a non-local
// host, and to the OpenWA port on any host, so tests can never reach OpenWA,
// WhatsApp, Gemini, Groq or any other real service.
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const OPENWA_PORT = '2785';
const realFetch = globalThis.fetch;

globalThis.fetch = async function guardedFetch(input, init) {
  const href = input instanceof Request ? input.url : String(input);
  const url = new URL(href);
  if (!LOCAL_HOSTS.has(url.hostname) || url.port === OPENWA_PORT) {
    throw new Error(`Blocked outbound fetch in tests: ${url.href}`);
  }
  return realFetch(input, init);
};
