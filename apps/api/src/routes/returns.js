const { reconcileReturns } = require('../services/reconciliation');

async function returnsRoutes(fastify, options) {
    fastify.addHook('preHandler', fastify.authenticate);

    // Upload GST Return
    fastify.post('/upload', async (request, reply) => {
        const { returnType, period, gstinId, data, fileName } = request.body || {};

        if (!returnType || !period || !gstinId || !data) {
            return reply.status(400).send({ error: 'returnType, period, gstinId, and data are required' });
        }

        // Verify GSTIN belongs to tenant's client
        const gstin = await fastify.prisma.gSTIN.findUnique({
            where: { id: gstinId },
            include: { client: true }
        });

        if (!gstin || gstin.client.tenantId !== request.user.tenantId) {
            return reply.status(404).send({ error: 'GSTIN not found' });
        }

        const gstReturn = await fastify.prisma.gSTReturn.create({
            data: {
                returnType,
                period,
                fileName: fileName || `${returnType}_${period}.json`,
                data: typeof data === 'string' ? data : JSON.stringify(data),
                tenantId: request.user.tenantId,
                gstinId
            }
        });

        return reply.status(201).send(gstReturn);
    });

    // List returns
    fastify.get('/', async (request) => {
        const { gstinId, returnType, period } = request.query || {};
        const where = { tenantId: request.user.tenantId };

        if (gstinId) where.gstinId = gstinId;
        if (returnType) where.returnType = returnType;
        if (period) where.period = period;

        const returns = await fastify.prisma.gSTReturn.findMany({
            where,
            include: { gstin: { include: { client: true } }, _count: { select: { mismatches: true } } },
            orderBy: { uploadedAt: 'desc' }
        });

        return { returns };
    });

    // Reconcile two returns
    fastify.post('/reconcile', async (request, reply) => {
        const { returnId1, returnId2 } = request.body || {};

        if (!returnId1 || !returnId2) {
            return reply.status(400).send({ error: 'Two return IDs are required for reconciliation' });
        }

        const [return1, return2] = await Promise.all([
            fastify.prisma.gSTReturn.findFirst({
                where: { id: returnId1, tenantId: request.user.tenantId }
            }),
            fastify.prisma.gSTReturn.findFirst({
                where: { id: returnId2, tenantId: request.user.tenantId }
            })
        ]);

        if (!return1 || !return2) {
            return reply.status(404).send({ error: 'One or both returns not found' });
        }

        const data1 = JSON.parse(return1.data);
        const data2 = JSON.parse(return2.data);

        const mismatches = reconcileReturns(data1, data2);

        // Store mismatches
        if (mismatches.length > 0) {
            await fastify.prisma.mismatch.createMany({
                data: mismatches.map(m => ({
                    returnId: returnId1,
                    invoiceNo: m.invoiceNo,
                    supplierGstin: m.supplierGstin,
                    field: m.field,
                    filed: String(m.filed),
                    matched: String(m.matched),
                    difference: String(m.difference)
                }))
            });
        }

        return {
            totalMatched: mismatches.length === 0 ? data1.invoices?.length || 0 : 0,
            totalMismatches: mismatches.length,
            mismatches
        };
    });

    // Get mismatches for a return
    fastify.get('/:id/mismatches', async (request) => {
        const mismatches = await fastify.prisma.mismatch.findMany({
            where: {
                returnId: request.params.id,
                gstReturn: { tenantId: request.user.tenantId }
            },
            orderBy: { createdAt: 'desc' }
        });

        return { mismatches };
    });
}

module.exports = returnsRoutes;
