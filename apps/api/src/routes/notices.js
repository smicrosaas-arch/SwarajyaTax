async function noticeRoutes(fastify, options) {
    fastify.addHook('preHandler', fastify.authenticate);

    // List notices
    fastify.get('/', async (request) => {
        const { status, clientId } = request.query || {};
        const where = { tenantId: request.user.tenantId };

        if (status) where.status = status;
        if (clientId) where.clientId = clientId;

        const notices = await fastify.prisma.notice.findMany({
            where,
            include: { client: true },
            orderBy: { createdAt: 'desc' }
        });

        return { notices };
    });

    // Create notice
    fastify.post('/', async (request, reply) => {
        const { title, description, noticeType, dueDate, clientId } = request.body || {};

        if (!title || !noticeType) {
            return reply.status(400).send({ error: 'title and noticeType are required' });
        }

        const notice = await fastify.prisma.notice.create({
            data: {
                title,
                description,
                noticeType,
                dueDate: dueDate ? new Date(dueDate) : null,
                clientId,
                tenantId: request.user.tenantId
            }
        });

        return reply.status(201).send(notice);
    });

    // Update notice
    fastify.put('/:id', async (request, reply) => {
        const { title, description, status, dueDate } = request.body || {};

        const existing = await fastify.prisma.notice.findFirst({
            where: { id: request.params.id, tenantId: request.user.tenantId }
        });

        if (!existing) {
            return reply.status(404).send({ error: 'Notice not found' });
        }

        const notice = await fastify.prisma.notice.update({
            where: { id: request.params.id },
            data: {
                ...(title && { title }),
                ...(description !== undefined && { description }),
                ...(status && { status }),
                ...(dueDate && { dueDate: new Date(dueDate) })
            }
        });

        return notice;
    });
}

module.exports = noticeRoutes;
