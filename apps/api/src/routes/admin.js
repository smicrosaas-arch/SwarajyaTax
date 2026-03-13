async function adminRoutes(fastify, options) {
    // Middleware to restrict access to SYSTEM_ADMIN role
    fastify.addHook('preHandler', async (request, reply) => {
        await fastify.authenticate(request, reply);
        if (request.user.role !== 'SYSTEM_ADMIN') {
            return reply.status(403).send({ error: 'Access denied: System Admin only' });
        }
    });

    // 1. Platform Overview Stats
    fastify.get('/stats', async (request) => {
        const tenantCount = await fastify.prisma.tenant.count();
        const userCount = await fastify.prisma.user.count();
        const clientCount = await fastify.prisma.client.count();
        const syncJobCount = await fastify.prisma.syncJob.count();
        const successSyncs = await fastify.prisma.syncJob.count({ where: { status: 'COMPLETED' } });
        const failedSyncs = await fastify.prisma.syncJob.count({ where: { status: 'FAILED' } });

        return {
            tenants: tenantCount,
            users: userCount,
            clients: clientCount,
            syncJobs: {
                total: syncJobCount,
                success: successSyncs,
                failed: failedSyncs,
                successRate: syncJobCount > 0 ? ((successSyncs / syncJobCount) * 100).toFixed(1) + '%' : '0%'
            }
        };
    });

    // 2. List all Tenants
    fastify.get('/tenants', async () => {
        const tenants = await fastify.prisma.tenant.findMany({
            include: {
                _count: { select: { users: true, clients: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        return { tenants };
    });

    // 3. System-wide Audit Logs
    fastify.get('/audit-logs', async (request) => {
        const logs = await fastify.prisma.auditLog.findMany({
            include: {
                user: { select: { name: true, email: true } },
                tenant: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 100
        });
        return { logs };
    });

    // 4. Manual User Management (Super Admin can see all)
    fastify.get('/users', async () => {
        const users = await fastify.prisma.user.findMany({
            include: {
                tenant: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        return { users };
    });
}

module.exports = adminRoutes;
