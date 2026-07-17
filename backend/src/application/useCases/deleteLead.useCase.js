const leadRepository = require('../../infrastructure/database/lead.repository');
const { Prisma } = require('@prisma/client');

async function deleteLead(id) {
  const lead = await leadRepository.findLeadById(id);
  if (!lead) {
    throw new Error('Lead not found');
  }

  try {
    return await leadRepository.deleteLead(id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw new Error('Cannot delete a lead with an existing conversation');
    }
    throw err;
  }
}

module.exports = { deleteLead };