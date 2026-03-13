async function clientRoutes(fastify, options) {
    // All routes require authentication
    fastify.addHook('preHandler', fastify.authenticate);

    // List all clients for tenant
    fastify.get('/', async (request) => {
        const { search, page = 1, limit = 20 } = request.query || {};
        const where = { tenantId: request.user.tenantId, isActive: true };

        if (search) {
            where.OR = [
                { name: { contains: search } },
                { tradeName: { contains: search } },
                { email: { contains: search } }
            ];
        }

        const [clients, total] = await Promise.all([
            fastify.prisma.client.findMany({
                where,
                include: { gstins: true, _count: { select: { documents: true, notices: true } } },
                skip: (Number(page) - 1) * Number(limit),
                take: Number(limit),
                orderBy: { createdAt: 'desc' }
            }),
            fastify.prisma.client.count({ where })
        ]);

        return { clients, total, page: Number(page), limit: Number(limit) };
    });

    // Create client
    fastify.post('/', async (request, reply) => {
        let { name, tradeName, email, phone, address, gstin } = request.body || {};

        if (!name && !gstin) {
            return reply.status(400).send({ error: 'Client name or GSTIN is required' });
        }

        // Phase 1: Real-time GSTIN Verification
        let gstinData = null;
        if (gstin && gstin.trim().length >= 15) {
            try {
                gstinData = await fastify.gsp.verifyGSTIN(gstin.trim().toUpperCase());
                // Enrich data if not provided by user
                if (!name) name = gstinData.legalName;
                if (!tradeName) tradeName = gstinData.tradeName;
            } catch (err) {
                fastify.log.error(`GSTIN Verification failed: ${err.message}`);
                // Continue even if verification fails, but log it
            }
        }

        const client = await fastify.prisma.client.create({
            data: {
                name: name || 'Unknown Client',
                tradeName,
                email,
                phone,
                address,
                tenantId: request.user.tenantId
            }
        });

        if (gstin && gstin.trim().length >= 15) {
            await fastify.prisma.gSTIN.create({
                data: {
                    gstin: gstin.trim().toUpperCase(),
                    clientId: client.id,
                    state: gstinData?.state || null,
                    status: gstinData?.status || 'ACTIVE'
                }
            });
        }

        // Fetch the full client object with gstins to return to the frontend
        const fullClient = await fastify.prisma.client.findUnique({
            where: { id: client.id },
            include: { gstins: true, _count: { select: { documents: true, notices: true } } }
        });

        return reply.status(201).send(fullClient);
    });

    // Get client detail
    fastify.get('/:id', async (request, reply) => {
        const client = await fastify.prisma.client.findFirst({
            where: { id: request.params.id, tenantId: request.user.tenantId },
            include: {
                gstins: true,
                documents: true,
                notices: { orderBy: { createdAt: 'desc' }, take: 10 }
            }
        });

        if (!client) {
            return reply.status(404).send({ error: 'Client not found' });
        }

        return client;
    });

    // Update client
    fastify.put('/:id', async (request, reply) => {
        const { name, tradeName, email, phone, address } = request.body || {};

        const existing = await fastify.prisma.client.findFirst({
            where: { id: request.params.id, tenantId: request.user.tenantId }
        });

        if (!existing) {
            return reply.status(404).send({ error: 'Client not found' });
        }

        const client = await fastify.prisma.client.update({
            where: { id: request.params.id },
            data: { name, tradeName, email, phone, address }
        });

        return client;
    });

    // Soft-delete client
    fastify.delete('/:id', async (request, reply) => {
        const existing = await fastify.prisma.client.findFirst({
            where: { id: request.params.id, tenantId: request.user.tenantId }
        });

        if (!existing) {
            return reply.status(404).send({ error: 'Client not found' });
        }

        await fastify.prisma.client.update({
            where: { id: request.params.id },
            data: { isActive: false }
        });

        return { success: true };
    });
}

module.exports = clientRoutes;
