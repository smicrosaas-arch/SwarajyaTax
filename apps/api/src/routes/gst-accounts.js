async function gstAccountRoutes(fastify, options) {
    fastify.addHook('preHandler', fastify.authenticate);

    // Step 1: Request OTP from GST Portal
    fastify.post('/connect/request-otp', async (request, reply) => {
        const { gstinId, username } = request.body || {};

        if (!gstinId || !username) {
            return reply.status(400).send({ error: 'gstinId and username are required' });
        }

        // Verify GSTIN belongs to tenant's client
        const gstin = await fastify.prisma.gSTIN.findUnique({
            where: { id: gstinId },
            include: { client: true }
        });

        if (!gstin || gstin.client.tenantId !== request.user.tenantId) {
            return reply.status(404).send({ error: 'GSTIN not found' });
        }

        try {
            const result = await fastify.gsp.requestOTP(username);
            return {
                success: true,
                transactionId: result.transactionId,
                message: result.message || 'OTP sent successfully'
            };
        } catch (err) {
            return reply.status(500).send({ error: err.message });
        }
    });

    // Step 2: Verify OTP and Connect
    fastify.post('/connect/verify', async (request, reply) => {
        const { gstinId, username, otp, transactionId } = request.body || {};

        if (!gstinId || !username || !otp || !transactionId) {
            return reply.status(400).send({ error: 'Missing required fields: gstinId, username, otp, transactionId' });
        }

        // Verify GSTIN belongs to tenant
        const gstin = await fastify.prisma.gSTIN.findUnique({
            where: { id: gstinId },
            include: { client: true }
        });

        if (!gstin || gstin.client.tenantId !== request.user.tenantId) {
            return reply.status(404).send({ error: 'GSTIN not found' });
        }

        try {
            const result = await fastify.gsp.verifyOTP(username, otp, transactionId);

            if (result.success) {
                // Upsert GSTAccount
                const account = await fastify.prisma.gSTAccount.upsert({
                    where: { gstinId },
                    update: {
                        username,
                        isConnected: true,
                        syncStatus: 'READY',
                        lastSyncAt: null // Reset on new connection
                    },
                    create: {
                        gstinId,
                        username,
                        isConnected: true,
                        syncStatus: 'READY'
                    }
                });

                return { success: true, account, message: 'GST account connected successfully!' };
            } else {
                return reply.status(400).send({ error: result.message || 'OTP verification failed' });
            }
        } catch (err) {
            return reply.status(500).send({ error: err.message });
        }
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

        // Call real GSP service to download returns
        const targetPeriod = period || (String(new Date().getMonth()).padStart(2, '0') + new Date().getFullYear()); // Default to prev month
        const downloadedReturns = [];

        for (const returnType of reportTypes) {
            try {
                const realData = await fastify.gsp.downloadReturn(account.username, returnType, targetPeriod);

                const gstReturn = await fastify.prisma.gSTReturn.create({
                    data: {
                        returnType,
                        period: targetPeriod,
                        fileName: `${returnType}_${targetPeriod}_real.json`,
                        data: JSON.stringify(realData),
                        tenantId: request.user.tenantId,
                        gstinId: account.gstin.id,
                    }
                });

                downloadedReturns.push({
                    returnType,
                    id: gstReturn.id,
                    invoiceCount: Array.isArray(realData.invoices) ? realData.invoices.length : (realData.summary?.total_invoices || 0)
                });
            } catch (err) {
                console.error(`[Sync] Failed to download ${returnType}: ${err.message}`);
            }
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
        const targetPeriod = period || (String(new Date().getMonth()).padStart(2, '0') + new Date().getFullYear());
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
                try {
                    const realData = await fastify.gsp.downloadReturn(account.username, rt, targetPeriod);
                    const gstReturn = await fastify.prisma.gSTReturn.create({
                        data: {
                            returnType: rt, period: targetPeriod,
                            fileName: `${rt}_${targetPeriod}_real.json`,
                            data: JSON.stringify(realData),
                            tenantId: request.user.tenantId,
                            gstinId: account.gstin.id
                        }
                    });
                    downloaded.push({ returnType: rt, id: gstReturn.id });
                } catch (err) {
                    console.error(`[Bulk Sync] Failed for ${account.username} - ${rt}: ${err.message}`);
                }
            }

            await fastify.prisma.syncJob.update({
                where: { id: syncJob.id },
                data: {
                    status: 'COMPLETED',
                    progress: 100,
                    result: JSON.stringify({ downloadedCount: downloaded.length, reportTypes: downloaded.map(d => d.returnType) }),
                    completedAt: new Date()
                }
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
