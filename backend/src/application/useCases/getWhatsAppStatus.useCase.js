const openwaClient = require('../../infrastructure/whatsapp/openwa.client');

const NOT_REACHED = { configured: true, reachable: false, status: null, ready: false };

// OpenWA session status for the dashboard: exactly four fields, nothing else from OpenWA.
async function getWhatsAppStatus() {
  try {
    const { status } = await openwaClient.getSessionStatus();
    return { configured: true, reachable: true, status, ready: status === 'ready' };
  } catch (err) {
    if (err.code === 'NOT_CONFIGURED') return { configured: false, reachable: false, status: null, ready: false };
    if (err.code === 'UNREACHABLE' || err.code === 'TIMEOUT') return { ...NOT_REACHED };
    throw err;
  }
}

module.exports = { getWhatsAppStatus };
