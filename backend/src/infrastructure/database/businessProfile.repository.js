const prisma = require('./prismaClient');

async function createBusinessProfile(data) {
  return prisma.businessProfile.create({ data });
}

async function updateBusinessProfile(id, data) {
  return prisma.businessProfile.update({ where: { id }, data });
}

async function getBusinessProfile() {
  return prisma.businessProfile.findFirst({ orderBy: { id: 'asc' } });
}

module.exports = { createBusinessProfile, updateBusinessProfile, getBusinessProfile };
