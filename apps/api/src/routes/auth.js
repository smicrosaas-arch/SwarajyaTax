const bcrypt = require('bcryptjs');

async function authRoutes(fastify, options) {
    // Register - creates org + owner user
    fastify.post('/register', async (request, reply) => {
        const { email, password, name, orgName } = request.body || {};

        if (!email || !password || !name || !orgName) {
            return reply.status(400).send({ error: 'email, password, name, and orgName are required' });
        }

        // Check if user already exists
        const existing = await fastify.prisma.user.findUnique({ where: { email } });
        if (existing) {
            return reply.status(409).send({ error: 'User with this email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Create tenant and user in a transaction
        const result = await fastify.prisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
                data: { name: orgName, email }
            });

            const user = await tx.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    name,
                    role: 'OWNER',
                    tenantId: tenant.id
                }
            });

            return { tenant, user };
        });

        const token = fastify.jwt.sign({
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
            role: result.user.role,
            tenantId: result.tenant.id
        });

        return reply.status(201).send({
            token,
            user: {
                id: result.user.id,
                email: result.user.email,
                name: result.user.name,
                role: result.user.role,
                orgName: result.tenant.name
            }
        });
    });

    // Login
    fastify.post('/login', async (request, reply) => {
        const { email, password } = request.body || {};

        if (!email || !password) {
            return reply.status(400).send({ error: 'email and password are required' });
        }

        const user = await fastify.prisma.user.findUnique({
            where: { email },
            include: { tenant: true }
        });

        if (!user) {
            return reply.status(401).send({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return reply.status(401).send({ error: 'Invalid credentials' });
        }

        const token = fastify.jwt.sign({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            tenantId: user.tenantId
        });

        return {
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                orgName: user.tenant.name
            }
        };
    });

    // Get current user profile
    fastify.get('/me', {
        preHandler: [fastify.authenticate]
    }, async (request, reply) => {
        const user = await fastify.prisma.user.findUnique({
            where: { id: request.user.id },
            include: { tenant: true }
        });

        if (!user) {
            return reply.status(404).send({ error: 'User not found' });
        }

        return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            orgName: user.tenant.name,
            tenantId: user.tenantId
        };
    });
}

module.exports = authRoutes;
