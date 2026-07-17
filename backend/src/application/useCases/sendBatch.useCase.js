const campaignRepository = require('../../infrastructure/database/campaign.repository');
const conversationRepository = require('../../infrastructure/database/conversation.repository');
const createMessageUseCase = require('./createMessage.useCase');

async function sendBatch(campaignId, count) {
  const campaign = await campaignRepository.findCampaignById(campaignId);
  if (!campaign) {
    throw new Error('Campaign not found');
  }
  if (campaign.status !== 'ACTIVE') {
    throw new Error('Campaign is paused. Activate it before sending.');
  }
  if (!count || count < 1) {
    throw new Error('count must be a positive number');
  }

  const leads = await campaignRepository.findLeadsForBatch(campaignId, count);

  const results = [];
  for (const lead of leads) {
    const conversation = await conversationRepository.createConversation(lead.id);
    await createMessageUseCase.createMessage(conversation.id, {
      sender: 'AI',
      content: `Hi ${lead.name || 'there'}! Thanks for your interest — how can we help?`,
    });
    results.push({ leadId: lead.id, conversationId: conversation.id });
  }

  return { sentCount: results.length, results };
}

module.exports = { sendBatch };