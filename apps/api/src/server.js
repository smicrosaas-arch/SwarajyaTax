const fastify = require('fastify');
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const { PrismaClient } = require('@prisma/client');

const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const gstinRoutes = require('./routes/gstins');
const returnsRoutes = require('./routes/returns');
const noticeRoutes = require('./routes/notices');
const taskRoutes = require('./routes/tasks');
const dashboardRoutes = require('./routes/dashboard');
const gstAccountRoutes = require('./routes/gst-accounts');

const prisma = new PrismaClient();

const app = fastify({ logger: true });

async function start() {
    // Register plugins
    await app.register(cors, { origin: true, credentials: true });
    await app.register(jwt, { secret: process.env.JWT_SECRET || 'gst-compliance-secret-key-change-me' });

    // Decorate with prisma
    app.decorate('prisma', prisma);

    // Auth decorator
    app.decorate('authenticate', async function (request, reply) {
        try {
            await request.jwtVerify();
        } catch (err) {
            reply.status(401).send({ error: 'Unauthorized' });
        }
    });

    // Audit logging hook for mutating requests
    app.addHook('onResponse', async (request, reply) => {
        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method) && request.user) {
            try {
                await prisma.auditLog.create({
                    data: {
                        action: `${request.method} ${request.url}`,
                        entity: request.url.split('/')[2] || 'unknown',
                        details: JSON.stringify({ statusCode: reply.statusCode }),
                        userId: request.user.id,
                        tenantId: request.user.tenantId,
                    }
                });
            } catch (e) {
                // Don't fail on audit log errors
            }
        }
    });

    // Register routes
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.register(clientRoutes, { prefix: '/api/clients' });
    await app.register(gstinRoutes, { prefix: '/api/gstins' });
    await app.register(returnsRoutes, { prefix: '/api/returns' });
    await app.register(noticeRoutes, { prefix: '/api/notices' });
    await app.register(taskRoutes, { prefix: '/api/tasks' });
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    await app.register(gstAccountRoutes, { prefix: '/api/gst-accounts' });

    // Health check
    app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

    const port = process.env.API_PORT || 3001;
    await app.listen({ port: Number(port), host: '0.0.0.0' });
    console.log(`API server running on http://localhost:${port}`);
}

start().catch((err) => {
    console.error(err);
    process.exit(1);
});
