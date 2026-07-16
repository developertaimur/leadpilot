const prisma = require('./prismaClient');

async function createLead({ name, phoneNumber, source }) {
  return prisma.lead.create({
    data: { name, phoneNumber, source },
  });
}

async function findLeadByPhone(phoneNumber) {
  return prisma.lead.findUnique({ where: { phoneNumber } });
}

module.exports = { createLead, findLeadByPhone };