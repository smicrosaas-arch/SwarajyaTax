async function gstAccountRoutes(fastify, options) {
    const { encrypt, decrypt } = require('../utils/crypto');
    const XLSX = require('xlsx');
    fastify.addHook('preHandler', fastify.authenticate);
    const DEFAULT_REPORT_TYPES = ['GSTR1', 'GSTR2A', 'GSTR2B', 'GSTR3B'];
    const isSandboxProvider = fastify.gsp.provider.includes('SANDBOX');

    function getAccountSessionKey({ gstinId, username, accountId }) {
        return `gst_${gstinId || accountId || username}`;
    }

    function getDefaultPeriod() {
        const now = new Date();
        const target = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const month = String(target.getMonth() + 1).padStart(2, '0');
        const year = String(target.getFullYear());
        return `${month}${year}`;
    }

    function classifySyncFailure(error) {
        const message = error?.message || 'Unknown GST portal error';
        if (error?.code === 'SESSION_EXPIRED' || /not authenticated anymore|reconnect the GST account|captcha|otp/i.test(message)) {
            return { syncStatus: 'SESSION_EXPIRED', message };
        }

        return { syncStatus: 'FAILED', message };
    }

    async function setAccountStatus(accountId, syncStatus, extra = {}) {
        return fastify.prisma.gSTAccount.update({
            where: { id: accountId },
            data: { syncStatus, ...extra }
        });
    }

    async function runSyncForAccount({ account, tenantId, reportTypes, period, jobType = 'AUTO_DOWNLOAD' }) {
        if (!account.isConnected) {
            throw new Error('Account is not connected. Please reconnect.');
        }

        if (!account.password && !isSandboxProvider) {
            throw new Error('No stored GST portal password found. Reconnect this account first.');
        }

        const syncJob = await fastify.prisma.syncJob.create({
            data: {
                accountId: account.id,
                jobType,
                reportTypes: JSON.stringify(reportTypes),
                period: period || null,
                status: 'IN_PROGRESS',
                startedAt: new Date()
            }
        });

        await setAccountStatus(account.id, 'SYNCING');

        const targetPeriod = period || getDefaultPeriod();
        const downloadedReturns = [];
        const failures = [];
        let finalAccountStatus = 'SYNCED';

        for (const returnType of reportTypes) {
            try {
                const decryptedPassword = decrypt(account.password);
                if (!decryptedPassword && !isSandboxProvider) {
                    throw new Error('Stored password could not be decrypted. Reconnect this account.');
                }

                const realData = await fastify.gsp.downloadReturn(
                    {
                        username: account.username,
                        gstin: account.gstin.gstin,
                        returnType,
                        period: targetPeriod,
                        password: decryptedPassword,
                        sessionKey: getAccountSessionKey({ accountId: account.id, gstinId: account.gstinId, username: account.username })
                    }
                );

                const gstReturn = await fastify.prisma.gSTReturn.create({
                    data: {
                        returnType,
                        period: targetPeriod,
                        fileName: `${returnType}_${targetPeriod}_real.json`,
                        data: JSON.stringify(realData),
                        tenantId,
                        gstinId: account.gstin.id,
                    }
                });

                downloadedReturns.push({
                    returnType,
                    id: gstReturn.id,
                    invoiceCount: Array.isArray(realData.invoices) ? realData.invoices.length : (realData.summary?.total_invoices || 0)
                });
            } catch (err) {
                const classified = classifySyncFailure(err);
                console.error(`[Sync] Failed to download ${returnType}: ${classified.message}`);
                if (classified.syncStatus === 'SESSION_EXPIRED') {
                    finalAccountStatus = 'SESSION_EXPIRED';
                } else if (finalAccountStatus !== 'SESSION_EXPIRED') {
                    finalAccountStatus = 'FAILED';
                }
                failures.push({ returnType, error: classified.message, action: classified.syncStatus });
            }
        }

        const syncStatus = failures.length === 0
            ? 'COMPLETED'
            : downloadedReturns.length > 0
                ? 'PARTIAL'
                : 'FAILED';

        if (failures.length === 0) {
            finalAccountStatus = 'SYNCED';
        } else if (downloadedReturns.length > 0 && finalAccountStatus !== 'SESSION_EXPIRED') {
            finalAccountStatus = 'PARTIAL';
        }

        await fastify.prisma.syncJob.update({
            where: { id: syncJob.id },
            data: {
                status: syncStatus,
                progress: 100,
                result: JSON.stringify({ downloadedReturns, failures }),
                error: failures.length ? failures.map(item => `${item.returnType}: ${item.error}`).join(' | ') : null,
                completedAt: new Date()
            }
        });

        await setAccountStatus(account.id, finalAccountStatus, {
            lastSyncAt: downloadedReturns.length > 0 ? new Date() : account.lastSyncAt
        });

        return {
            syncJob: { id: syncJob.id, status: syncStatus },
            downloadedReturns,
            failures,
            accountStatus: finalAccountStatus,
            targetPeriod
        };
    }

    // Step 1: Request OTP from GST Portal
    fastify.post('/connect/request-otp', async (request, reply) => {
        const { gstinId, username, password } = request.body || {};

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
            const existingAccount = await fastify.prisma.gSTAccount.findUnique({
                where: { gstinId }
            });

            if (!existingAccount) {
                try {
                    await fastify.usage.ensureGstAccountCreationAllowed(request.user.tenantId);
                } catch (err) {
                    if (err.code === 'PLAN_LIMIT_REACHED') {
                        return reply.status(402).send({ error: err.message, code: err.code, metric: err.metric, limit: err.limit, planKey: err.planKey });
                    }
                    throw err;
                }
            }

            const sessionKey = getAccountSessionKey({ gstinId, username, accountId: existingAccount?.id });
            const result = await fastify.gsp.requestOTP(username, password, sessionKey, { gstin: gstin.gstin });
            const nextStep = result.nextStep || (result.captcha ? 'CAPTCHA' : 'OTP');
            const nextStatus = nextStep === 'OTP' ? 'OTP_REQUIRED' : 'CAPTCHA_REQUIRED';

            await fastify.prisma.gSTAccount.upsert({
                where: { gstinId },
                update: {
                    username,
                    password: password ? encrypt(password) : existingAccount?.password || null,
                    isConnected: false,
                    syncStatus: nextStatus,
                    lastSyncAt: existingAccount?.lastSyncAt || null
                },
                create: {
                    gstinId,
                    username,
                    password: password ? encrypt(password) : null,
                    isConnected: false,
                    syncStatus: nextStatus
                }
            });

            return {
                success: true,
                transactionId: result.transactionId,
                captcha: result.captcha, // Base64 captcha for Puppeteer provider
                nextStep,
                message: result.message || 'Login initialized'
            };
        } catch (err) {
            return reply.status(500).send({ error: err.message });
        }
    });

    // Step 2: Verify OTP and Connect
    fastify.post('/connect/verify', async (request, reply) => {
        const { gstinId, username, password, otp, transactionId, captchaValue, resumeSync = false, period, reportTypes = DEFAULT_REPORT_TYPES } = request.body || {};

        if (!gstinId || !username || (!otp && !captchaValue)) {
            return reply.status(400).send({ error: 'Missing required fields: gstinId, username, and either otp or captcha' });
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
            // Pass password and captchaValue to the service for Puppeteer flow
            const existingAccount = await fastify.prisma.gSTAccount.findUnique({ where: { gstinId } });
            const result = await fastify.gsp.verifyOTP(username, password, otp, transactionId, captchaValue, { gstin: gstin.gstin });

            if (result.success) {
                // Upsert GSTAccount
                const account = await fastify.prisma.gSTAccount.upsert({
                    where: { gstinId },
                    update: {
                        username,
                        password: password ? encrypt(password) : existingAccount?.password || null,
                        isConnected: true,
                        syncStatus: 'READY',
                        lastSyncAt: null
                    },
                    create: {
                        gstinId,
                        username,
                        password: password ? encrypt(password) : null,
                        isConnected: true,
                        syncStatus: 'READY'
                    }
                });

                if (resumeSync) {
                    const hydratedAccount = await fastify.prisma.gSTAccount.findUnique({
                        where: { id: account.id },
                        include: { gstin: { include: { client: true } } }
                    });
                    const syncResult = await runSyncForAccount({
                        account: hydratedAccount,
                        tenantId: request.user.tenantId,
                        reportTypes,
                        period
                    });

                    return {
                        success: true,
                        account: hydratedAccount,
                        syncResult,
                        nextStep: 'COMPLETE',
                        message: 'GST account connected and sync resumed successfully!'
                    };
                }

                return { success: true, account, nextStep: 'COMPLETE', message: 'GST account connected successfully!' };
            } else {
                await fastify.prisma.gSTAccount.upsert({
                    where: { gstinId },
                    update: {
                        username,
                        password: password ? encrypt(password) : undefined,
                        isConnected: false,
                        syncStatus: result.requiresOTP ? 'OTP_REQUIRED' : 'CAPTCHA_REQUIRED'
                    },
                    create: {
                        gstinId,
                        username,
                        password: password ? encrypt(password) : null,
                        isConnected: false,
                        syncStatus: result.requiresOTP ? 'OTP_REQUIRED' : 'CAPTCHA_REQUIRED'
                    }
                });

                return reply.status(400).send({
                    error: result.message || 'Verification failed',
                    requiresOTP: result.requiresOTP,
                    nextStep: result.requiresOTP ? 'OTP' : 'CAPTCHA'
                });
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

        const enriched = accounts.map(account => {
            const extensionManaged = account.username === 'extension-session';
            const hasStoredCredentials = Boolean(account.username && account.password);
            const requiresAttention = extensionManaged
                ? false
                : !account.isConnected || ['CAPTCHA_REQUIRED', 'OTP_REQUIRED', 'SESSION_EXPIRED', 'FAILED', 'PARTIAL'].includes(account.syncStatus);

            const nextAction = extensionManaged
                ? 'Use the Chrome extension to capture the current GST return page again'
                : !account.isConnected
                    ? (hasStoredCredentials
                        ? 'Open GST Portal to complete login and connect this account'
                        : 'Save GST portal credentials and connect this account')
                : account.syncStatus === 'CAPTCHA_REQUIRED'
                    ? 'Reconnect and solve captcha'
                    : account.syncStatus === 'OTP_REQUIRED'
                        ? 'Complete OTP verification'
                        : account.syncStatus === 'SESSION_EXPIRED'
                            ? 'Reconnect account and resume sync'
                            : account.syncStatus === 'FAILED'
                                ? 'Retry sync or reconnect'
                                : account.syncStatus === 'PARTIAL'
                                    ? 'Review failures and retry'
                                    : 'Ready';

            return {
                ...account,
                extensionManaged,
                hasStoredCredentials,
                requiresAttention,
                nextAction
            };
        });

        return { accounts: enriched };
    });

    fastify.post('/credentials', async (request, reply) => {
        const { gstinId, gstin, clientId, username, password } = request.body || {};

        if (!username || !password) {
            return reply.status(400).send({ error: 'GST portal username and password are required.' });
        }

        const where = {
            client: { tenantId: request.user.tenantId }
        };

        if (gstinId) where.id = gstinId;
        else if (gstin) where.gstin = String(gstin).trim().toUpperCase();
        else if (clientId) where.clientId = clientId;
        else {
            return reply.status(400).send({ error: 'gstinId, gstin, or clientId is required.' });
        }

        const gstinRecord = await fastify.prisma.gSTIN.findFirst({
            where,
            include: { client: true }
        });

        if (!gstinRecord) {
            return reply.status(404).send({ error: 'GSTIN not found for this tenant.' });
        }

        const existingAccount = await fastify.prisma.gSTAccount.findUnique({
            where: { gstinId: gstinRecord.id }
        });

        if (!existingAccount) {
            try {
                await fastify.usage.ensureGstAccountCreationAllowed(request.user.tenantId);
            } catch (err) {
                if (err.code === 'PLAN_LIMIT_REACHED') {
                    return reply.status(402).send({ error: err.message, code: err.code, metric: err.metric, limit: err.limit, planKey: err.planKey });
                }
                throw err;
            }
        }

        const account = await fastify.prisma.gSTAccount.upsert({
            where: { gstinId: gstinRecord.id },
            update: {
                username: username.trim(),
                password: encrypt(password),
                syncStatus: existingAccount?.syncStatus === 'SYNCED' ? 'READY' : (existingAccount?.syncStatus || 'READY'),
                isConnected: existingAccount?.isConnected || false
            },
            create: {
                gstinId: gstinRecord.id,
                username: username.trim(),
                password: encrypt(password),
                syncStatus: 'READY',
                isConnected: false
            }
        });

        return {
            success: true,
            accountId: account.id,
            gstinId: gstinRecord.id,
            gstin: gstinRecord.gstin,
            clientId: gstinRecord.clientId,
            clientName: gstinRecord.client.name,
            message: 'GST credentials saved successfully.'
        };
    });

    fastify.get('/extension/credentials', async (request, reply) => {
        const { gstinId, gstin, clientId } = request.query || {};

        const accounts = await fastify.prisma.gSTAccount.findMany({
            where: {
                gstin: { client: { tenantId: request.user.tenantId } }
            },
            include: {
                gstin: {
                    include: {
                        client: { select: { id: true, name: true } }
                    }
                }
            },
            orderBy: { updatedAt: 'desc' }
        });

        const withPasswords = accounts.filter((account) => account.password);
        const preferred = withPasswords.find((account) =>
            (gstinId && account.gstinId === gstinId)
            || (gstin && account.gstin?.gstin === gstin)
            || (clientId && account.gstin?.client?.id === clientId)
        );

        let account = preferred || null;

        if (!account && withPasswords.length === 1) {
            account = withPasswords[0];
        }

        if (!account && withPasswords.length > 1) {
            account = withPasswords[0];
        }

        if (!account) {
            return reply.status(404).send({
                error: 'No stored GST credentials found for this tenant.',
                code: 'GST_CREDENTIALS_NOT_FOUND'
            });
        }

        const decryptedPassword = decrypt(account.password);
        if (!decryptedPassword) {
            return reply.status(500).send({
                error: 'Stored GST password could not be decrypted.',
                code: 'GST_CREDENTIALS_UNREADABLE'
            });
        }

        return {
            accountId: account.id,
            gstinId: account.gstinId,
            gstin: account.gstin?.gstin || null,
            clientId: account.gstin?.client?.id || null,
            clientName: account.gstin?.client?.name || null,
            username: account.username,
            password: decryptedPassword
        };
    });

    fastify.post('/extension/snapshot', async (request, reply) => {
        const { gstin, period, reports = [], accountUsername = null, sourceUrl = null } = request.body || {};

        if (!gstin || !period || !Array.isArray(reports) || reports.length === 0) {
            return reply.status(400).send({ error: 'gstin, period and at least one report are required' });
        }

        const gstinRecord = await fastify.prisma.gSTIN.findFirst({
            where: {
                gstin,
                client: { tenantId: request.user.tenantId }
            },
            include: { client: true }
        });

        if (!gstinRecord) {
            return reply.status(404).send({ error: 'GSTIN not found for this tenant' });
        }

        const account = await fastify.prisma.gSTAccount.upsert({
            where: { gstinId: gstinRecord.id },
            update: {
                username: accountUsername || 'extension-session',
                isConnected: true,
                syncStatus: 'READY'
            },
            create: {
                gstinId: gstinRecord.id,
                username: accountUsername || 'extension-session',
                isConnected: true,
                syncStatus: 'READY'
            }
        });

        const savedReports = [];

        for (const report of reports) {
            if (!report?.returnType) continue;

            const payload = {
                gstin,
                returnType: report.returnType,
                period,
                invoices: Array.isArray(report.invoices) ? report.invoices : [],
                summary: report.summary || null,
                meta: {
                    ...(report.meta || {}),
                    sourceUrl,
                    capturedVia: 'chrome-extension',
                    capturedAt: new Date().toISOString()
                }
            };

            const existing = await fastify.prisma.gSTReturn.findFirst({
                where: {
                    tenantId: request.user.tenantId,
                    gstinId: gstinRecord.id,
                    returnType: report.returnType,
                    period
                },
                orderBy: { uploadedAt: 'desc' }
            });

            const fileName = `${report.returnType}_${period}_extension.json`;
            let saved;

            if (existing) {
                saved = await fastify.prisma.gSTReturn.update({
                    where: { id: existing.id },
                    data: {
                        fileName,
                        data: JSON.stringify(payload)
                    }
                });
            } else {
                saved = await fastify.prisma.gSTReturn.create({
                    data: {
                        returnType: report.returnType,
                        period,
                        fileName,
                        data: JSON.stringify(payload),
                        tenantId: request.user.tenantId,
                        gstinId: gstinRecord.id
                    }
                });
            }

            savedReports.push({
                id: saved.id,
                returnType: saved.returnType,
                period: saved.period
            });
        }

        await fastify.prisma.gSTAccount.update({
            where: { id: account.id },
            data: {
                lastSyncAt: new Date(),
                syncStatus: savedReports.length ? 'SYNCED' : 'FAILED'
            }
        });

        return {
            success: true,
            gstin,
            savedReports
        };
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
        const { reportTypes = DEFAULT_REPORT_TYPES, period } = request.body || {};

        const account = await fastify.prisma.gSTAccount.findUnique({
            where: { id: request.params.id },
            include: { gstin: { include: { client: true } } }
        });

        if (!account || account.gstin.client.tenantId !== request.user.tenantId) {
            return reply.status(404).send({ error: 'Account not found' });
        }

        try {
            await fastify.usage.ensureSyncAllowed(request.user.tenantId);
        } catch (err) {
            if (err.code === 'PLAN_LIMIT_REACHED') {
                return reply.status(402).send({ error: err.message, code: err.code, metric: err.metric, limit: err.limit, planKey: err.planKey });
            }
            throw err;
        }

        const result = await runSyncForAccount({
            account,
            tenantId: request.user.tenantId,
            reportTypes,
            period,
            jobType: 'AUTO_DOWNLOAD'
        });
        await fastify.usage.incrementSyncUsage(request.user.tenantId);

        return {
            ...result,
            message: result.failures.length === 0
                ? `Successfully downloaded ${result.downloadedReturns.length} reports`
                : `Downloaded ${result.downloadedReturns.length} reports with ${result.failures.length} failures`
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
        const targetPeriod = period || getDefaultPeriod();
        const reportTypes = DEFAULT_REPORT_TYPES;

        try {
            await fastify.usage.ensureSyncAllowed(request.user.tenantId);
        } catch (err) {
            if (err.code === 'PLAN_LIMIT_REACHED') {
                return reply.status(402).send({ error: err.message, code: err.code, metric: err.metric, limit: err.limit, planKey: err.planKey });
            }
            throw err;
        }

        for (const account of accounts) {
            const syncResult = await runSyncForAccount({
                account,
                tenantId: request.user.tenantId,
                reportTypes,
                period: targetPeriod,
                jobType: 'BULK_DOWNLOAD'
            });

            results.push({
                gstin: account.gstin.gstin,
                clientName: account.gstin.client.name,
                reportsDownloaded: syncResult.downloadedReturns.length,
                failures: syncResult.failures,
                accountStatus: syncResult.accountStatus
            });
        }
        await fastify.usage.incrementSyncUsage(request.user.tenantId, accounts.length);

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
                meta: parsed.meta || null,
                invoiceCount: parsed.invoices?.length || parsed.summary?.invoiceCount || parsed.summary?.total_invoices || 0
            };
        });

        return { gstin: gstin.gstin, clientName: gstin.client.name, reports: enriched };
    });

    // Download a specific report as Excel by default, with JSON as fallback
    fastify.get('/reports/download/:returnId', async (request, reply) => {
        const gstReturn = await fastify.prisma.gSTReturn.findUnique({
            where: { id: request.params.returnId },
            include: { gstin: { include: { client: true } } }
        });

        if (!gstReturn || gstReturn.gstin.client.tenantId !== request.user.tenantId) {
            return reply.status(404).send({ error: 'Report not found' });
        }

        let parsed = {};
        try {
            parsed = JSON.parse(gstReturn.data);
        } catch {
            parsed = {};
        }

        const requestedFormat = String(request.query?.format || '').toLowerCase();
        if (requestedFormat === 'json') {
            reply.header('Content-Type', 'application/json');
            reply.header('Content-Disposition', `attachment; filename="${gstReturn.fileName}"`);
            return JSON.stringify(parsed, null, 2);
        }

        const workbook = XLSX.utils.book_new();
        const invoices = Array.isArray(parsed.invoices) ? parsed.invoices : [];
        const taxValues = parsed.summary?.taxValues && typeof parsed.summary.taxValues === 'object'
            ? parsed.summary.taxValues
            : null;
        const filingStatus = Array.isArray(parsed.meta?.filingStatus) ? parsed.meta.filingStatus : [];
        const detailTables = Array.isArray(parsed.meta?.detailTables) ? parsed.meta.detailTables : [];
        const summarySheet = XLSX.utils.json_to_sheet([
            {
                GSTIN: parsed.gstin || gstReturn.gstin.gstin,
                Client: gstReturn.gstin.client.name,
                ReturnType: gstReturn.returnType,
                Period: gstReturn.period,
                Status: parsed.summary?.status || '',
                DueDate: parsed.summary?.dueDate || '',
                InvoiceCount: invoices.length,
                CaptureSource: parsed.summary?.source || parsed.meta?.capturedVia || '',
                CaptureMode: invoices.length ? 'Detailed' : 'Snapshot',
                DownloadedAt: gstReturn.uploadedAt.toISOString()
            }
        ]);
        XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

        const actions = Array.isArray(parsed.meta?.availableActions) ? parsed.meta.availableActions : [];
        if (actions.length) {
            const actionSheet = XLSX.utils.json_to_sheet(actions.map((action, index) => ({
                Order: index + 1,
                Action: action
            })));
            XLSX.utils.book_append_sheet(workbook, actionSheet, 'Actions');
        }

        if (taxValues && Object.keys(taxValues).length) {
            const taxValueSheet = XLSX.utils.json_to_sheet(
                Object.entries(taxValues).map(([field, value]) => ({
                    Field: field,
                    Value: value
                }))
            );
            XLSX.utils.book_append_sheet(workbook, taxValueSheet, 'TaxValues');
        }

        if (filingStatus.length) {
            const filingStatusSheet = XLSX.utils.json_to_sheet(
                filingStatus.map((statusLine, index) => ({
                    Order: index + 1,
                    Status: statusLine
                }))
            );
            XLSX.utils.book_append_sheet(workbook, filingStatusSheet, 'FilingStatus');
        }

        if (invoices.length) {
            const invoiceSheet = XLSX.utils.json_to_sheet(invoices.map((invoice, index) => ({
                Row: index + 1,
                ...invoice
            })));
            XLSX.utils.book_append_sheet(workbook, invoiceSheet, 'Invoices');
        } else if (detailTables.length) {
            detailTables.slice(0, 5).forEach((table, index) => {
                const tableSheet = XLSX.utils.json_to_sheet(table.rows || []);
                XLSX.utils.book_append_sheet(workbook, tableSheet, `Table${index + 1}`.slice(0, 31));
            });
        } else {
            const snapshotSheet = XLSX.utils.json_to_sheet([
                {
                    Note: 'Dashboard snapshot only. Detailed invoices were not captured.',
                    Preview: parsed.meta?.cardTextPreview || parsed.meta?.cardText || ''
                }
            ]);
            XLSX.utils.book_append_sheet(workbook, snapshotSheet, 'Snapshot');
        }

        const workbookBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
        const fileName = `${gstReturn.returnType}_${gstReturn.period}.xlsx`;
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
        return reply.send(workbookBuffer);
    });
}

module.exports = gstAccountRoutes;
