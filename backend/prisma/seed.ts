import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const reporterPassword = await bcrypt.hash('reporter', 10);
  const agentPassword = await bcrypt.hash('agent', 10);

  const reporter = await prisma.user.upsert({
    where: { email: 'reporter@example.com' },
    update: {},
    create: {
      email: 'reporter@example.com',
      name: 'Reporter User',
      passwordHash: reporterPassword,
      role: 'REPORTER'
    }
  });

  const agent = await prisma.user.upsert({
    where: { email: 'agent@example.com' },
    update: {},
    create: {
      email: 'agent@example.com',
      name: 'Agent User',
      passwordHash: agentPassword,
      role: 'AGENT'
    }
  });

  // Create holidays
  await prisma.holiday.createMany({
    data: [
      { date: new Date('2026-08-15T00:00:00Z'), name: 'Independence Day' },
      { date: new Date('2026-12-25T00:00:00Z'), name: 'Christmas' }
    ],
    skipDuplicates: true
  });

  // Create tickets
  await prisma.ticket.create({
    data: {
      title: 'Payment failed on checkout',
      description: 'I tried to pay with my credit card but it failed.',
      priority: 'URGENT',
      reporterId: reporter.id,
      status: 'OPEN'
    }
  });

  await prisma.ticket.create({
    data: {
      title: 'Login issue on mobile',
      description: 'Cannot login using Safari.',
      priority: 'HIGH',
      reporterId: reporter.id,
      status: 'OPEN'
    }
  });

  await prisma.ticket.create({
    data: {
      title: 'Request for invoice',
      description: 'Need invoice for last month.',
      priority: 'MEDIUM',
      reporterId: reporter.id,
      status: 'OPEN'
    }
  });

  await prisma.ticket.create({
    data: {
      title: 'Change profile picture',
      description: 'How do I do this?',
      priority: 'LOW',
      reporterId: reporter.id,
      status: 'OPEN'
    }
  });

  console.log('Seeding complete.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
