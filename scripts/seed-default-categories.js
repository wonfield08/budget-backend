// One-off backfill for accounts created before default categories were
// added to signup (see src/auth/auth.service.ts). Idempotent: only touches
// users who currently have zero categories, so it's safe to re-run.
//
// Run from the project root after `npm run build`:
//   node scripts/seed-default-categories.js
const { PrismaClient } = require('@prisma/client');
const { DEFAULT_CATEGORIES } = require('../dist/categories/default-categories');

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  let seeded = 0;

  for (const user of users) {
    const existingCount = await prisma.category.count({ where: { userId: user.id } });
    if (existingCount > 0) continue;

    await prisma.category.createMany({
      data: DEFAULT_CATEGORIES.map((category) => ({ ...category, userId: user.id })),
    });
    seeded++;
    console.log(`seeded default categories for ${user.email}`);
  }

  console.log(`done: ${seeded} seeded, ${users.length - seeded} already had categories`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
