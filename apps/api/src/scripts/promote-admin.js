const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const email = process.argv[2];
    if (!email) {
        console.error('Usage: node promote-admin.js <email>');
        process.exit(1);
    }

    const user = await prisma.user.update({
        where: { email },
        data: { role: 'SYSTEM_ADMIN' }
    });

    console.log(`Successfully promoted ${user.email} to SYSTEM_ADMIN`);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
