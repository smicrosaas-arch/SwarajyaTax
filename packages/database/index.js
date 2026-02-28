const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Prisma client generated successfully');
}

module.exports = { prisma };
