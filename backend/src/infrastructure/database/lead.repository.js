const prisma = require('./prismaClient');

async function createLead({ name, phoneNumber, source }) {
  return prisma.lead.create({
    data: { name, phoneNumber, source },
  });
}

async function findLeadByPhone(phoneNumber) {
  return prisma.lead.findUnique({ where: { phoneNumber } });
}

async function findAllLeads() {
  return prisma.lead.findMany({ orderBy: { createdAt: 'desc' } });
}

async function findLeadById(id) {
  return prisma.lead.findUnique({ where: { id } });
}

async function updateLeadStage(id, stage) {
  return prisma.lead.update({ where: { id }, data: { stage } });
}

async function deleteLead(id) {
  return prisma.lead.delete({ where: { id } });
}

async function updateLeadInfo(id, data) {
  return prisma.lead.update({ where: { id }, data });
}

module.exports = { createLead, findLeadByPhone, findAllLeads, findLeadById, updateLeadStage, deleteLead, updateLeadInfo };