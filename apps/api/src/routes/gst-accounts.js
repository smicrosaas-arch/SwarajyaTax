/**
 * GST Account Linking & Auto-Download Routes
 * Simulates OptoTax-like GST portal integration
 */

// Mock GSTR data generator for demo
function generateMockGSTR(returnType, period, gstin) {
    const invoiceCount = Math.floor(Math.random() * 15) + 5;
    const invoices = [];
    for (let i = 1; i <= invoiceCount; i++) {
        const taxable = Math.round((Math.random() * 50000 + 5000) * 100) / 100;
        const rate = [5, 12, 18, 28][Math.floor(Math.random() * 4)];
        const tax = Math.round(taxable * rate / 100 * 100) / 100;
        invoices.push({
            invoiceNo: `INV-${period}-${String(i).padStart(3, '0')}`,
            invoiceDate: `2026-${period.substring(0, 2)}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`,
            supplierGstin: `${String(Math.floor(Math.random() * 37) + 1).padStart(2, '0')}AAACB${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}Q1Z5`,
            tradeName: ['Ace Trading', 'Global Supplies', 'Metro Imports', 'Star Industries', 'Nova Corp'][Math.floor(Math.random() * 5)],
            taxableValue: taxable,
            rate: rate,
            igst: rate === 18 || rate === 28 ? tax : 0,
            cgst: rate === 5 || rate === 12 ? Math.round(tax / 2 * 100) / 100 : 0,
            sgst: rate === 5 || rate === 12 ? Math.round(tax / 2 * 100) / 100 : 0,
            cess: rate === 28 ? Math.round(taxable * 0.01 * 100) / 100 : 0,
            totalValue: Math.round((taxable + tax) * 100) / 100,
        });
    }
    return {
        gstin,
        returnType,
        period,
        fp: period,
        invoices,
        summary: {
            totalInvoices: invoices.length,
            totalTaxableValue: Math.round(invoices.reduce((s, i) => s + i.taxableValue, 0) * 100) / 100,
            totalIGST: Math.round(invoices.reduce((s, i) => s + i.igst, 0) * 100) / 100,
            totalCGST: Math.round(invoices.reduce((s, i) => s + i.cgst, 0) * 100) / 100,
            totalSGST: Math.round(invoices.reduce((s, i) => s + i.sgst, 0) * 100) / 100,
            totalCess: Math.round(invoices.reduce((s, i) => s + i.cess, 0) * 100) / 100,
        }
    };
}

async function gstAccountRoutes(fastify, options) {
    fastify.addHook('preHandler', fastify.authenticate);

    // Link a GST account (connect GSTIN credentials)
    fastify.post('/connect', async (request, reply) => {
        const { gstinId, username, password } = request.body || {};

        if (!gstinId || !username || !password) {
            return reply.status(400).send({ error: 'gstinId, username, and password are required' });
        }

        // Verify GSTIN belongs to tenant's client
        const gstin = await fastify.prisma.gSTIN.findUnique({
            where: { id: gstinId },
            include: { client: true }
        });

        if (!gstin || gstin.client.tenantId !== request.user.tenantId) {
            return reply.status(404).send({ error: 'GSTIN not found' });
        }

        // Check if already connected
        const existing = await fastify.prisma.gSTAccount.findUnique({ where: { gstinId } });
        if (existing) {
            // Update credentials
            const updated = await fastify.prisma.gSTAccount.update({
                where: { gstinId },
                data: { username, isConnected: true, syncStatus: 'READY' }
            });
            return { account: updated, message: 'Account credentials updated' };
        }

        // Simulate OTP verification (in production, this would call GST portal)
        const account = await fastify.prisma.gSTAccount.create({
            data: {
                gstinId,
                username,
                isConnected: true,
                syncStatus: 'READY'
            }
        });

        return reply.status(201).send({ account, message: 'GST account connected successfully' });
    });

    // List all connected GST accounts
    fastify.get('/', async (request) => {
        const accounts = await fastify.prisma.gSTAccount.findMany({
            where: {
                gstin: { client: { tenantId: request.user.tenantId } }
            },
            include: {
                gstin: { include: { client: { select: { name: true } } } },
                _count: { select: { syncJobs: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        return { accounts };
    });

    // Disconnect a GST account
    fastify.delete('/:id', async (request, reply) => {
        const account = await fastify.prisma.gSTAccount.findUnique({
            where: { id: request.params.id },
            include: { gstin: { include: { client: true } } }
        });

        if (!account || account.gstin.client.tenantId !== request.user.tenantId) {
            return reply.status(404).send({ error: 'Account not found' });
        }

        await fastify.prisma.gSTAccount.update({
            where: { id: request.params.id },
            data: { isConnected: false, syncStatus: 'DISCONNECTED' }
        });

        return { success: true };
    });

    // Trigger auto-download/sync for a GST account
    fastify.post('/:id/sync', async (request, reply) => {
        const { reportTypes = ['GSTR1', 'GSTR2A', 'GSTR2B', 'GSTR3B'], period } = request.body || {};

        const account = await fastify.prisma.gSTAccount.findUnique({
            where: { id: request.params.id },
            include: { gstin: { include: { client: true } } }
        });

        if (!account || account.gstin.client.tenantId !== request.user.tenantId) {
            return reply.status(404).send({ error: 'Account not found' });
        }

        if (!account.isConnected) {
            return reply.status(400).send({ error: 'Account is not connected. Please reconnect.' });
        }

        // Create sync job
        const syncJob = await fastify.prisma.syncJob.create({
            data: {
                accountId: account.id,
                jobType: 'AUTO_DOWNLOAD',
                reportTypes: JSON.stringify(reportTypes),
                period: period || null,
                status: 'IN_PROGRESS',
                startedAt: new Date()
            }
        });

        // Simulate async download — in production this would be Puppeteer automation
        const targetPeriod = period || new Date().toISOString().substring(5, 7) + new Date().getFullYear();
        const downloadedReturns = [];

        for (const returnType of reportTypes) {
            const mockData = generateMockGSTR(returnType, targetPeriod, account.gstin.gstin);

            const gstReturn = await fastify.prisma.gSTReturn.create({
                data: {
                    returnType,
                    period: targetPeriod,
                    fileName: `${returnType}_${targetPeriod}_auto.json`,
                    data: JSON.stringify(mockData),
                    tenantId: request.user.tenantId,
                    gstinId: account.gstin.id,
                }
            });

            downloadedReturns.push({ returnType, id: gstReturn.id, invoiceCount: mockData.invoices.length });
        }

        // Update sync job
        await fastify.prisma.syncJob.update({
            where: { id: syncJob.id },
            data: {
                status: 'COMPLETED',
                progress: 100,
                result: JSON.stringify({ downloadedReturns }),
                completedAt: new Date()
            }
        });

        // Update account sync status
        await fastify.prisma.gSTAccount.update({
            where: { id: account.id },
            data: { lastSyncAt: new Date(), syncStatus: 'SYNCED' }
        });

        return {
            syncJob: { id: syncJob.id, status: 'COMPLETED' },
            downloadedReturns,
            message: `Successfully downloaded ${downloadedReturns.length} reports`
        };
    });

    // Sync ALL connected accounts at once
    fastify.post('/sync-all', async (request, reply) => {
        const { period } = request.body || {};

        const accounts = await fastify.prisma.gSTAccount.findMany({
            where: {
                isConnected: true,
                gstin: { client: { tenantId: request.user.tenantId } }
            },
            include: { gstin: { include: { client: { select: { name: true } } } } }
        });

        if (accounts.length === 0) {
            return reply.status(400).send({ error: 'No connected GST accounts found' });
        }

        const results = [];
        const targetPeriod = period || `${String(new Date().getMonth() + 1).padStart(2, '0')}${new Date().getFullYear()}`;
        const reportTypes = ['GSTR1', 'GSTR2A', 'GSTR2B', 'GSTR3B'];

        for (const account of accounts) {
            const syncJob = await fastify.prisma.syncJob.create({
                data: {
                    accountId: account.id,
                    jobType: 'BULK_DOWNLOAD',
                    reportTypes: JSON.stringify(reportTypes),
                    period: targetPeriod,
                    status: 'IN_PROGRESS',
                    startedAt: new Date()
                }
            });

            const downloaded = [];
            for (const rt of reportTypes) {
                const mockData = generateMockGSTR(rt, targetPeriod, account.gstin.gstin);
                const gstReturn = await fastify.prisma.gSTReturn.create({
                    data: {
                        returnType: rt, period: targetPeriod,
                        fileName: `${rt}_${targetPeriod}_auto.json`,
                        data: JSON.stringify(mockData),
                        tenantId: request.user.tenantId,
                        gstinId: account.gstin.id
                    }
                });
                downloaded.push({ returnType: rt, id: gstReturn.id });
            }

            await fastify.prisma.syncJob.update({
                where: { id: syncJob.id },
                data: { status: 'COMPLETED', progress: 100, result: JSON.stringify({ downloaded }), completedAt: new Date() }
            });

            await fastify.prisma.gSTAccount.update({
                where: { id: account.id },
                data: { lastSyncAt: new Date(), syncStatus: 'SYNCED' }
            });

            results.push({
                gstin: account.gstin.gstin,
                clientName: account.gstin.client.name,
                reportsDownloaded: downloaded.length
            });
        }

        return { totalAccounts: accounts.length, results, message: `Synced ${accounts.length} accounts` };
    });

    // Get sync history/jobs
    fastify.get('/sync-jobs', async (request) => {
        const jobs = await fastify.prisma.syncJob.findMany({
            where: {
                account: { gstin: { client: { tenantId: request.user.tenantId } } }
            },
            include: {
                account: { include: { gstin: { select: { gstin: true } } } }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        return { jobs };
    });

    // Get downloaded reports for a GSTIN (with download links)
    fastify.get('/reports/:gstinId', async (request) => {
        const gstin = await fastify.prisma.gSTIN.findUnique({
            where: { id: request.params.gstinId },
            include: { client: true }
        });

        if (!gstin || gstin.client.tenantId !== request.user.tenantId) {
            return { reports: [] };
        }

        const reports = await fastify.prisma.gSTReturn.findMany({
            where: { gstinId: request.params.gstinId },
            orderBy: [{ returnType: 'asc' }, { period: 'desc' }]
        });

        // Parse and summarize each report
        const enriched = reports.map(r => {
            let parsed = {};
            try { parsed = JSON.parse(r.data); } catch { }
            return {
                id: r.id,
                returnType: r.returnType,
                period: r.period,
                fileName: r.fileName,
                uploadedAt: r.uploadedAt,
                summary: parsed.summary || null,
                invoiceCount: parsed.invoices?.length || 0
            };
        });

        return { gstin: gstin.gstin, clientName: gstin.client.name, reports: enriched };
    });

    // Download a specific report as JSON
    fastify.get('/reports/download/:returnId', async (request, reply) => {
        const gstReturn = await fastify.prisma.gSTReturn.findUnique({
            where: { id: request.params.returnId },
            include: { gstin: { include: { client: true } } }
        });

        if (!gstReturn || gstReturn.gstin.client.tenantId !== request.user.tenantId) {
            return reply.status(404).send({ error: 'Report not found' });
        }

        reply.header('Content-Type', 'application/json');
        reply.header('Content-Disposition', `attachment; filename="${gstReturn.fileName}"`);
        return gstReturn.data;
    });
}

module.exports = gstAccountRoutes;
