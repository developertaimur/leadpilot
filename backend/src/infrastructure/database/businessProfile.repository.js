const prisma = require('./prismaClient');

async function upsertBusinessProfile({ name, context }) {
  const existing = await prisma.businessProfile.findFirst();
  if (existing) {
    return prisma.businessProfile.update({
      where: { id: existing.id },
      data: { name, context },
    });
  }
  return prisma.businessProfile.create({ data: { name, context } });
}

async function getBusinessProfile() {
  return prisma.businessProfile.findFirst();
}

module.exports = { upsertBusinessProfile, getBusinessProfile };