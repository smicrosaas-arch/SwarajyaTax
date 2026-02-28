async function gstinRoutes(fastify, options) {
    fastify.addHook('preHandler', fastify.authenticate);

    // Add GSTIN to a client
    fastify.post('/client/:clientId', async (request, reply) => {
        const { gstin, state } = request.body || {};
        const { clientId } = request.params;

        if (!gstin) {
            return reply.status(400).send({ error: 'GSTIN is required' });
        }

        // Validate GSTIN format (15 chars alphanumeric)
        if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) {
            return reply.status(400).send({ error: 'Invalid GSTIN format' });
        }

        // Verify client belongs to tenant
        const client = await fastify.prisma.client.findFirst({
            where: { id: clientId, tenantId: request.user.tenantId }
        });

        if (!client) {
            return reply.status(404).send({ error: 'Client not found' });
        }

        const gstinRecord = await fastify.prisma.gSTIN.create({
            data: { gstin, state, clientId }
        });

        return reply.status(201).send(gstinRecord);
    });

    // List GSTINs for a client
    fastify.get('/client/:clientId', async (request) => {
        const { clientId } = request.params;

        const client = await fastify.prisma.client.findFirst({
            where: { id: clientId, tenantId: request.user.tenantId }
        });

        if (!client) {
            return { gstins: [] };
        }

        const gstins = await fastify.prisma.gSTIN.findMany({
            where: { clientId },
            orderBy: { createdAt: 'desc' }
        });

        return { gstins };
    });

    // Delete GSTIN
    fastify.delete('/:id', async (request, reply) => {
        const gstinRecord = await fastify.prisma.gSTIN.findUnique({
            where: { id: request.params.id },
            include: { client: true }
        });

        if (!gstinRecord || gstinRecord.client.tenantId !== request.user.tenantId) {
            return reply.status(404).send({ error: 'GSTIN not found' });
        }

        await fastify.prisma.gSTIN.delete({ where: { id: request.params.id } });

        return { success: true };
    });
}

module.exports = gstinRoutes;
