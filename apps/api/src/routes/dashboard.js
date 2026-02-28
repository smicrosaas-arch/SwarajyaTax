async function dashboardRoutes(fastify, options) {
    fastify.addHook('preHandler', fastify.authenticate);

    // Dashboard stats
    fastify.get('/stats', async (request) => {
        const tenantId = request.user.tenantId;

        const [
            totalClients,
            totalGstins,
            pendingTasks,
            pendingNotices,
            totalReturns,
            totalMismatches
        ] = await Promise.all([
            fastify.prisma.client.count({ where: { tenantId, isActive: true } }),
            fastify.prisma.gSTIN.count({
                where: { client: { tenantId } }
            }),
            fastify.prisma.task.count({ where: { tenantId, status: { not: 'DONE' } } }),
            fastify.prisma.notice.count({ where: { tenantId, status: 'PENDING' } }),
            fastify.prisma.gSTReturn.count({ where: { tenantId } }),
            fastify.prisma.mismatch.count({
                where: { gstReturn: { tenantId }, status: 'UNRESOLVED' }
            })
        ]);

        return {
            totalClients,
            totalGstins,
            pendingTasks,
            pendingNotices,
            totalReturns,
            totalMismatches
        };
    });

    // Upcoming deadlines (tasks due in next 7 days)
    fastify.get('/upcoming', async (request) => {
        const tenantId = request.user.tenantId;
        const now = new Date();
        const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const [upcomingTasks, upcomingNotices] = await Promise.all([
            fastify.prisma.task.findMany({
                where: {
                    tenantId,
                    status: { not: 'DONE' },
                    dueDate: { gte: now, lte: nextWeek }
                },
                include: { assignee: { select: { name: true } } },
                orderBy: { dueDate: 'asc' },
                take: 10
            }),
            fastify.prisma.notice.findMany({
                where: {
                    tenantId,
                    status: { not: 'CLOSED' },
                    dueDate: { gte: now, lte: nextWeek }
                },
                include: { client: { select: { name: true } } },
                orderBy: { dueDate: 'asc' },
                take: 10
            })
        ]);

        return { upcomingTasks, upcomingNotices };
    });

    // Audit log
    fastify.get('/audit-log', async (request) => {
        const { page = 1, limit = 50 } = request.query || {};
        const tenantId = request.user.tenantId;

        const [logs, total] = await Promise.all([
            fastify.prisma.auditLog.findMany({
                where: { tenantId },
                include: { user: { select: { name: true, email: true } } },
                orderBy: { createdAt: 'desc' },
                skip: (Number(page) - 1) * Number(limit),
                take: Number(limit)
            }),
            fastify.prisma.auditLog.count({ where: { tenantId } })
        ]);

        return { logs, total };
    });
}

module.exports = dashboardRoutes;
