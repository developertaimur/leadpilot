const campaignRepository = require('../../infrastructure/database/campaign.repository');
const conversationRepository = require('../../infrastructure/database/conversation.repository');
const leadRepository = require('../../infrastructure/database/lead.repository');
const { OpenWAError } = require('../../infrastructure/whatsapp/openwa.client');
const createMessageUseCase = require('./createMessage.useCase');
const env = require('../../config/env');

const LIMIT_REACHED = 'First-contact limit for the last 24 hours reached';
const WINDOW_MS = 24 * 60 * 60 * 1000;
// OpenWA errors that end the whole batch at once.
const STOP_CODES = new Set(['SEND_PACING_LIMITED', 'NOT_CONFIGURED']);

// One batch per process. Both are lost on restart: leads still at NEW are picked up by the next batch.
let running = false;
// When the last send attempt of any batch finished, so sends are never closer than BATCH_DELAY_SECONDS.
let lastAttemptAt = -Infinity;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(campaignId, text) {
  console.info(`Batch campaign ${campaignId}: ${text}`);
}

function greeting(lead) {
  return `Hi ${lead.name || 'there'}! Thanks for your interest — how can we help?`;
}

// First contacts left in the rolling 24-hour window (campaign conversations created in it count).
async function remainingAllowance() {
  const used = await conversationRepository.countRecentCampaignConversations(new Date(Date.now() - WINDOW_MS));
  return Math.max(0, env.batchDailyCap - used);
}

// The lead, if it can still get a first message: it exists, is at NEW and has no conversation.
async function eligibleLead(leadId) {
  const lead = await leadRepository.findLeadById(leadId);
  if (!lead || lead.stage !== 'NEW') return null;
  return (await conversationRepository.findConversationByLeadId(leadId)) ? null : lead;
}

async function stopReason(campaignId) {
  const campaign = await campaignRepository.findCampaignById(campaignId);
  if (!campaign || campaign.status !== 'ACTIVE') return 'campaign paused';
  if ((await remainingAllowance()) === 0) return '24-hour cap reached';
  return null;
}

async function waitForNextSlot() {
  const wait = lastAttemptAt + env.batchDelaySeconds * 1000 - Date.now();
  if (wait > 0) await sleep(wait);
}

// What a failed send tells us. 'notSent' frees the lead for the next batch. 'unknown' keeps its
// conversation so the lead is never greeted twice: the message may already have gone out.
function failureOutcome(err) {
  if (!(err instanceof OpenWAError)) return 'unknown';
  if (err.code === 'UNREACHABLE') return err.neverConnected ? 'notSent' : 'unknown';
  if (err.code === 'TIMEOUT' || err.status >= 500) return 'unknown';
  if (err.status >= 400 || err.code === 'NOT_CONFIGURED' || err.code === 'INVALID_TEXT') return 'notSent';
  return 'unknown';
}

async function attempt(lead) {
  let conversation;
  try {
    conversation = await conversationRepository.createConversation(lead.id);
  } catch (err) {
    if (err.code === 'P2002') return { skipped: true }; // an inbound message created it meanwhile
    throw err;
  }
  try {
    await createMessageUseCase.createMessage(conversation.id, { sender: 'AI', content: greeting(lead) });
    return { sent: true };
  } catch (err) {
    const outcome = failureOutcome(err);
    if (outcome === 'notSent') await conversationRepository.deleteConversationIfEmpty(conversation.id);
    return { outcome, err };
  } finally {
    lastAttemptAt = Date.now();
  }
}

async function runBatch(campaignId, leads) {
  const counts = { sent: 0, failed: 0, unknown: 0, skipped: 0 };
  let failuresInARow = 0;
  let stopped = null;
  const skip = (leadId) => {
    counts.skipped++;
    log(campaignId, `lead ${leadId} skipped (no longer eligible)`);
  };

  console.info(`Batch started for campaign ${campaignId}: ${leads.length} queued`);
  for (const queued of leads) {
    if (!(await eligibleLead(queued.id))) {
      skip(queued.id);
      continue;
    }
    await waitForNextSlot();
    stopped = await stopReason(campaignId);
    if (stopped) break;
    const lead = await eligibleLead(queued.id);
    if (!lead) {
      skip(queued.id);
      continue;
    }

    const result = await attempt(lead);
    if (result.skipped) {
      skip(lead.id);
      continue;
    }
    if (result.sent) {
      counts.sent++;
      failuresInARow = 0;
      log(campaignId, `lead ${lead.id} sent`);
      continue;
    }

    failuresInARow++;
    if (result.outcome === 'notSent') {
      counts.failed++;
      log(campaignId, `lead ${lead.id} failed (${result.err.code ?? result.err.status ?? result.err.name})`);
    } else {
      counts.unknown++;
      log(campaignId, `lead ${lead.id} outcome unknown, check chat manually`);
    }
    if (STOP_CODES.has(result.err.code)) {
      stopped = `OpenWA ${result.err.code}`;
      break;
    }
    if (failuresInARow >= env.batchMaxConsecutiveFailures) {
      stopped = `${failuresInARow} failures in a row`;
      break;
    }
  }

  const { sent, failed, unknown, skipped } = counts;
  console.info(
    `Batch finished for campaign ${campaignId}: sent ${sent}, failed ${failed}, unknown ${unknown}, skipped ${skipped}` +
      (stopped ? `, stopped: ${stopped}` : ''),
  );
  return { ...counts, stopped };
}

// Validates and queues a batch, then sends in the background, one lead at a time.
// Returns { campaignId, queued, remaining, done }; `done` settles when the background run ends.
async function sendBatch(campaignId, count) {
  if (running) throw new Error('A batch is already running');
  running = true; // set before the first await, so two requests at once cannot both start

  let remaining;
  let leads;
  try {
    if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive whole number');
    const campaign = await campaignRepository.findCampaignById(campaignId);
    if (!campaign) throw new Error('Campaign not found');
    if (campaign.status !== 'ACTIVE') throw new Error('Campaign is paused. Activate it before sending.');
    remaining = await remainingAllowance();
    if (remaining === 0) throw new Error(LIMIT_REACHED);
    leads = await campaignRepository.findLeadsForBatch(campaignId, Math.min(count, remaining));
  } catch (err) {
    running = false;
    throw err;
  }

  if (leads.length === 0) {
    running = false;
    return { campaignId, queued: 0, remaining, done: Promise.resolve(null) };
  }

  const done = runBatch(campaignId, leads)
    .catch((err) => {
      console.error(`Batch for campaign ${campaignId} stopped by an unexpected error (${err.code ?? err.name})`);
      return null;
    })
    .finally(() => {
      running = false;
    });
  return { campaignId, queued: leads.length, remaining, done };
}

module.exports = { sendBatch };
