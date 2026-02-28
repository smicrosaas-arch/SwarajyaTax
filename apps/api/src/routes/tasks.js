async function taskRoutes(fastify, options) {
    fastify.addHook('preHandler', fastify.authenticate);

    // List tasks
    fastify.get('/', async (request) => {
        const { status, assigneeId, priority } = request.query || {};
        const where = { tenantId: request.user.tenantId };

        if (status) where.status = status;
        if (assigneeId) where.assigneeId = assigneeId;
        if (priority) where.priority = priority;

        const tasks = await fastify.prisma.task.findMany({
            where,
            include: {
                assignee: { select: { id: true, name: true, email: true } },
                creator: { select: { id: true, name: true } }
            },
            orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }]
        });

        return { tasks };
    });

    // Create task
    fastify.post('/', async (request, reply) => {
        const { title, description, priority, dueDate, assigneeId } = request.body || {};

        if (!title) {
            return reply.status(400).send({ error: 'Task title is required' });
        }

        const task = await fastify.prisma.task.create({
            data: {
                title,
                description,
                priority: priority || 'MEDIUM',
                dueDate: dueDate ? new Date(dueDate) : null,
                assigneeId,
                creatorId: request.user.id,
                tenantId: request.user.tenantId
            },
            include: {
                assignee: { select: { id: true, name: true, email: true } }
            }
        });

        return reply.status(201).send(task);
    });

    // Update task
    fastify.put('/:id', async (request, reply) => {
        const { title, description, status, priority, dueDate, assigneeId } = request.body || {};

        const existing = await fastify.prisma.task.findFirst({
            where: { id: request.params.id, tenantId: request.user.tenantId }
        });

        if (!existing) {
            return reply.status(404).send({ error: 'Task not found' });
        }

        const task = await fastify.prisma.task.update({
            where: { id: request.params.id },
            data: {
                ...(title && { title }),
                ...(description !== undefined && { description }),
                ...(status && { status }),
                ...(priority && { priority }),
                ...(dueDate && { dueDate: new Date(dueDate) }),
                ...(assigneeId !== undefined && { assigneeId })
            },
            include: {
                assignee: { select: { id: true, name: true, email: true } }
            }
        });

        return task;
    });

    // Task stats
    fastify.get('/stats', async (request) => {
        const tenantId = request.user.tenantId;

        const [total, todo, inProgress, done] = await Promise.all([
            fastify.prisma.task.count({ where: { tenantId } }),
            fastify.prisma.task.count({ where: { tenantId, status: 'TODO' } }),
            fastify.prisma.task.count({ where: { tenantId, status: 'IN_PROGRESS' } }),
            fastify.prisma.task.count({ where: { tenantId, status: 'DONE' } })
        ]);

        return { total, todo, inProgress, done };
    });
}

module.exports = taskRoutes;
