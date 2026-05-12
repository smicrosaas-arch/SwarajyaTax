const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const GST_LOGIN_URL = 'https://services.gst.gov.in/services/login';
const GST_AUTH_DASHBOARD_URL = 'https://services.gst.gov.in/services/auth/dashboard';
const GST_WELCOME_URL = 'https://services.gst.gov.in/services/auth/fowelcome';
const GST_RETURN_DASHBOARD_URL = 'https://return.gst.gov.in/returns/auth/dashboard';
const SESSION_ROOT = path.resolve(process.cwd(), '.gst-browser-profiles');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TRANSIENT_NAVIGATION_ERROR = /ERR_CONNECTION_RESET|Navigation timeout|net::ERR_/i;
const ACTIVE_PORTAL_SESSIONS = new Map();
const CAPTCHA_SESSION_TTL_MS = 3 * 60 * 1000;
const GST_PUBLIC_SEARCH_GSTIN_PATH = '/gst/compliance/public/gstin/search';
const GST_PUBLIC_TRACK_RETURNS_PATH = '/gst/compliance/public/gstrs/track';
const GST_TAXPAYER_OTP_PATH = '/gst/compliance/tax-payer/otp';
const GST_TAXPAYER_VERIFY_OTP_PATH = '/gst/compliance/tax-payer/otp/verify';

class GSPService {
    constructor(config) {
        this.apiKey = config.apiKey;
        this.secret = config.secret;
        this.provider = (config.provider || 'PUPPETEER').trim().toUpperCase();
        this.baseUrl = config.baseUrl || 'https://api.sandbox.co.in';
        this.sandboxAuthToken = null;
        this.sandboxAuthExpiresAt = 0;
    }

    getSessionKey(sessionKey, username) {
        return String(sessionKey || username || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    getProfileDir(sessionKey, username) {
        const key = this.getSessionKey(sessionKey, username);
        const dir = path.join(SESSION_ROOT, key);
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    async cleanupProfileLocks(profileDir) {
        const lockNames = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile'];

        await Promise.all(lockNames.map(async (name) => {
            try {
                await fs.promises.rm(path.join(profileDir, name), { force: true, recursive: true });
            } catch (err) {
                console.error(`[GSP Debug] Failed to remove profile lock ${name}: ${err.message}`);
            }
        }));
    }

    async launchBrowser(sessionKey, username) {
        const profileDir = this.getProfileDir(sessionKey, username);
        await this.cleanupProfileLocks(profileDir);

        return puppeteer.launch({
            headless: "new",
            userDataDir: profileDir,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });
    }

    async createPage(browser) {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
        return page;
    }

    async clearSession(sessionKey, username) {
        const profileDir = this.getProfileDir(sessionKey, username);
        await fs.promises.rm(profileDir, { recursive: true, force: true });
    }

    async releaseActiveSession(sessionKey, { preserveProfile = true } = {}) {
        const key = this.getSessionKey(sessionKey);
        const activeSession = ACTIVE_PORTAL_SESSIONS.get(key);
        if (!activeSession) {
            return;
        }

        ACTIVE_PORTAL_SESSIONS.delete(key);
        activeSession.closed = true;

        try {
            if (!preserveProfile) {
                await this.clearSession(key, activeSession.username);
            }
        } catch (err) {
            console.error(`[GSP Debug] Failed clearing session ${key}: ${err.message}`);
        }

        try {
            await activeSession.browser.close();
        } catch (err) {
            console.error(`[GSP Debug] Failed closing active browser ${key}: ${err.message}`);
        }
    }

    rememberActiveSession(sessionKey, username, browser, page) {
        const key = this.getSessionKey(sessionKey, username);
        const existingSession = ACTIVE_PORTAL_SESSIONS.get(key);
        if (existingSession && !existingSession.closed) {
            this.releaseActiveSession(key).catch((err) => {
                console.error(`[GSP Debug] Failed replacing active session ${key}: ${err.message}`);
            });
        }

        ACTIVE_PORTAL_SESSIONS.set(key, {
            key,
            username,
            browser,
            page,
            createdAt: Date.now(),
            closed: false
        });

        return key;
    }

    getActiveSession(sessionKey, username) {
        const key = this.getSessionKey(sessionKey, username);
        const activeSession = ACTIVE_PORTAL_SESSIONS.get(key);
        if (!activeSession || activeSession.closed) {
            return null;
        }

        return activeSession;
    }

    async captureDebugArtifacts(page, sessionKey, username, prefix) {
        try {
            const profileDir = this.getProfileDir(sessionKey, username);
            await page.screenshot({ path: path.join(profileDir, `${prefix}.png`), fullPage: true });
            const html = await page.content();
            await fs.promises.writeFile(path.join(profileDir, `${prefix}.html`), html, 'utf8');
        } catch (err) {
            console.error(`[GSP Debug] Failed to capture artifacts: ${err.message}`);
        }
    }

    createTaggedError(message, code) {
        const error = new Error(message);
        error.code = code;
        return error;
    }

    async authenticateSandbox() {
        const now = Date.now();
        if (this.sandboxAuthToken && this.sandboxAuthExpiresAt > now + 60_000) {
            return this.sandboxAuthToken;
        }

        if (!this.apiKey || !this.secret) {
            throw new Error('Sandbox API key/secret are not configured');
        }

        const response = await fetch(`${this.baseUrl}/authenticate`, {
            method: 'POST',
            headers: {
                'x-api-key': this.apiKey,
                'x-api-secret': this.secret,
                'x-api-version': '1.0.0',
                'Content-Type': 'application/json'
            }
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.message || payload?.error || `Sandbox authenticate failed: ${response.status}`);
        }

        const accessToken = payload?.data?.access_token;
        if (!accessToken) {
            throw new Error('Sandbox authenticate did not return an access token');
        }

        this.sandboxAuthToken = accessToken;
        this.sandboxAuthExpiresAt = now + 24 * 60 * 60 * 1000;
        return accessToken;
    }

    async sandboxRequest(method, pathname, { query, body, authorization, acceptCache = false, source = 'primary', apiVersion = '1.0.0' } = {}) {
        const token = authorization || await this.authenticateSandbox();
        const url = new URL(pathname, this.baseUrl);

        if (query) {
            Object.entries(query).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') {
                    url.searchParams.set(key, String(value));
                }
            });
        }

        const response = await fetch(url, {
            method,
            headers: {
                'x-api-key': this.apiKey,
                'authorization': token,
                'x-api-version': apiVersion,
                'x-source': source,
                'x-accept-cache': String(Boolean(acceptCache)),
                'Content-Type': 'application/json'
            },
            body: body ? JSON.stringify(body) : undefined
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.message || payload?.error || payload?.data?.message || `Sandbox API failed: ${response.status}`);
        }

        return payload;
    }

    unwrapSandboxData(payload) {
        if (payload?.data?.data !== undefined) {
            return payload.data.data;
        }

        if (payload?.data !== undefined) {
            return payload.data;
        }

        return payload;
    }

    formatSandboxFinancialYear(period) {
        const month = parseInt(String(period).slice(0, 2), 10);
        const year = parseInt(String(period).slice(2), 10);

        if (!month || !year) return null;
        return month <= 3 ? `FY ${year - 1}-${String(year).slice(-2)}` : `FY ${year}-${String(year + 1).slice(-2)}`;
    }

    mapSandboxReturnFilter(returnType) {
        const mapping = {
            GSTR1: 'gstr-1',
            GSTR2A: 'gstr-2a',
            GSTR2B: 'gstr-2b',
            GSTR3B: 'gstr-3b'
        };

        return mapping[returnType] || returnType.toLowerCase();
    }

    async trackSandboxReturns(gstin, period, returnType, acceptCache = true) {
        const financialYear = this.formatSandboxFinancialYear(period);
        if (!financialYear) {
            throw new Error(`Invalid GST period: ${period}`);
        }

        const payload = await this.sandboxRequest('POST', GST_PUBLIC_TRACK_RETURNS_PATH, {
            query: {
                financial_year: financialYear,
                gstr: this.mapSandboxReturnFilter(returnType)
            },
            body: { gstin },
            acceptCache
        });

        const result = this.unwrapSandboxData(payload);
        const filedList = Array.isArray(result?.EFiledlist) ? result.EFiledlist : [];
        const exactMatch = filedList.find((entry) => String(entry.ret_prd) === String(period) && String(entry.rtntype).toUpperCase() === String(returnType).toUpperCase());

        return {
            gstin,
            returnType,
            period,
            invoices: [],
            filings: filedList,
            summary: {
                status: exactMatch?.status || 'NOT_FOUND',
                filingDate: exactMatch?.dof || null,
                arn: exactMatch?.arn || null,
                filingMode: exactMatch?.mof || null,
                valid: exactMatch?.valid || null,
                source: 'Sandbox GST public return tracking'
            },
            meta: {
                financialYear,
                matched: Boolean(exactMatch),
                transactionId: payload?.transaction_id || null,
                cached: acceptCache
            }
        };
    }

    async gotoWithRetry(page, url, options = {}, attempts = 3) {
        let lastError;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                await page.goto(url, options);
                return;
            } catch (err) {
                lastError = err;
                if (!TRANSIENT_NAVIGATION_ERROR.test(err.message || '') || attempt === attempts) {
                    throw err;
                }

                console.warn(`[GSP Puppeteer] Retrying navigation to ${url} after transient error: ${err.message}`);
                await sleep(1200 * attempt);
            }
        }

        throw lastError;
    }

    async hasPeriodSelectors(page) {
        return page.evaluate(() => {
            const fin = document.querySelector('#fin, select[name="fin"], select[id*="fin"]');
            const period = document.querySelector('#period, select[name="period"], select[name="mon"], select[id*="period"]');
            return Boolean(fin && period);
        }).catch(() => false);
    }

    isOnReturnsSite(url) {
        return Boolean(url && (url.includes('return.gst.gov.in') || url.includes('returns2.gst.gov.in')));
    }

    async waitForPeriodSelectors(page, timeout = 12000) {
        try {
            await page.waitForSelector('#fin, select[name="fin"], select[id*="fin"]', { timeout });
            return await this.hasPeriodSelectors(page);
        } catch {
            return false;
        }
    }

    async navigateToPortalDashboard(page) {
        await this.gotoWithRetry(page, GST_AUTH_DASHBOARD_URL, { waitUntil: 'networkidle2', timeout: 60000 }, 2).catch(() => null);

        if (await this.isLoggedIn(page)) {
            return;
        }

        await this.gotoWithRetry(page, GST_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60000 }, 2).catch(() => null);

        if (!(await this.isLoggedIn(page))) {
            throw this.createTaggedError(
                'Stored GST session is not authenticated anymore. Reconnect the GST account and complete captcha/OTP again.',
                'SESSION_EXPIRED'
            );
        }
    }

    async waitForPortalLogin(page, timeout = 20000) {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeout) {
            if (await this.isLoggedIn(page)) {
                return true;
            }

            const loginState = await page.evaluate(() => {
                const text = document.body?.innerText?.toLowerCase() || '';
                return {
                    hasCaptchaField: Boolean(document.querySelector('#captcha')),
                    hasUsernameField: Boolean(document.querySelector('#username')),
                    invalidCaptcha: (
                        text.includes('invalid captcha') ||
                        text.includes('enter valid captcha') ||
                        text.includes('captcha is invalid') ||
                        text.includes('captcha code is invalid') ||
                        text.includes('wrong captcha') ||
                        text.includes('invalid captcha code')
                    ),
                    invalidCredentials: (
                        text.includes('invalid username') ||
                        text.includes('invalid password') ||
                        text.includes('invalid username or password')
                    ),
                    portalMessage: text
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .find((line) =>
                            /captcha|invalid|username|password|error|incorrect|try again/.test(line)
                        ) || null
                };
            }).catch(() => ({
                hasCaptchaField: false,
                hasUsernameField: false,
                invalidCaptcha: false,
                invalidCredentials: false,
                portalMessage: null
            }));

            if (loginState.invalidCaptcha) {
                throw this.createTaggedError(
                    loginState.portalMessage || 'GST portal rejected the CAPTCHA. Reload and try again.',
                    'CAPTCHA_INVALID'
                );
            }

            if (loginState.invalidCredentials) {
                throw this.createTaggedError(
                    loginState.portalMessage || 'GST portal rejected the username or password.',
                    'INVALID_CREDENTIALS'
                );
            }

            if (loginState.hasCaptchaField && loginState.hasUsernameField && Date.now() - startedAt > 10000) {
                throw this.createTaggedError(
                    loginState.portalMessage || 'GST portal stayed on the login page after CAPTCHA submission. Please reload and try a fresh CAPTCHA.',
                    'LOGIN_STILL_ON_PORTAL'
                );
            }

            await sleep(1000);
        }

        return false;
    }

    async getPageDiagnostics(page) {
        return page.evaluate(() => ({
            title: document.title || null,
            url: location.href,
            headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,.card-title,.tab-content'))
                .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean)
                .slice(0, 12),
            actions: Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"]'))
                .map((el) => (el.textContent || el.value || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean)
                .slice(0, 24)
        })).catch(() => ({ title: null, url: page.url(), headings: [], actions: [] }));
    }

    getReturnCandidates(returnType) {
        const candidates = {
            GSTR1: ['gstr1', 'gstr-1', 'prepare online', 'details of outward supplies'],
            GSTR2A: ['gstr2a', 'gstr-2a', 'auto drafted', 'inward supplies'],
            GSTR2B: ['gstr2b', 'gstr-2b', 'auto-drafted itc statement', 'itc statement'],
            GSTR3B: ['gstr3b', 'gstr-3b', 'monthly summary', 'summary return']
        };

        return candidates[returnType] || [returnType.toLowerCase()];
    }

    async clickMatchingAction(page, patterns) {
        return page.evaluate((values) => {
            const normalized = values.map((value) => value.toLowerCase());
            const elements = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"]'));

            const target = elements.find((element) => {
                const text = (element.textContent || element.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
                if (!text) return false;
                const style = window.getComputedStyle(element);
                const visible = style.display !== 'none' && style.visibility !== 'hidden';
                return visible && normalized.some((value) => text.includes(value));
            });

            if (!target) return null;

            const descriptor = (target.textContent || target.value || '').replace(/\s+/g, ' ').trim();
            target.click();
            return descriptor;
        }, patterns);
    }

    async clickMatchingOnclickPath(page, pathFragments) {
        return page.evaluate((fragments) => {
            const normalized = fragments.map((fragment) => fragment.toLowerCase());
            const elements = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"]'));

            const target = elements.find((element) => {
                const onclick = (element.getAttribute('onclick') || '').toLowerCase();
                if (!onclick) return false;

                const style = window.getComputedStyle(element);
                const visible = style.display !== 'none' && style.visibility !== 'hidden';
                return visible && normalized.some((fragment) => onclick.includes(fragment));
            });

            if (!target) return null;

            const descriptor = (target.textContent || target.value || target.getAttribute('title') || target.getAttribute('onclick') || '')
                .replace(/\s+/g, ' ')
                .trim();
            target.click();
            return descriptor;
        }, pathFragments);
    }

    async navigateToReturnWorkspace(browser, page, returnType, period, sessionKey, username) {
        // If already on the returns site with period selectors, nothing to do
        if (this.isOnReturnsSite(page.url())) {
            if (await this.waitForPeriodSelectors(page, 10000)) return page;
        }

        const beforeDiag = await this.getPageDiagnostics(page);
        console.log(`[GSP Puppeteer] Navigating to returns dashboard from: ${beforeDiag.url}`);

        // Strategy 1: Click "RETURN DASHBOARD" button on fowelcome
        // The GST portal opens return.gst.gov.in in a NEW TAB — we watch both possibilities.
        const navSameTab = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => null);
        const btnClicked = await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('a, button, input[type="submit"]'));
            const btn = els.find(el => {
                const text = (el.textContent || el.value || '').toLowerCase().trim();
                const onclick = (el.getAttribute('onclick') || '').toLowerCase();
                const vis = window.getComputedStyle(el).display !== 'none';
                return vis && (
                    (text.includes('return') && text.includes('dashboard')) ||
                    onclick.includes('/returns/auth/dashboard') ||
                    (onclick.includes('return') && onclick.includes('dashboard'))
                );
            });
            if (btn) { btn.click(); return (btn.textContent || btn.value || 'btn').replace(/\s+/g, ' ').trim(); }
            return null;
        });

        if (btnClicked) {
            console.log(`[GSP Puppeteer] Clicked return dashboard button: "${btnClicked}"`);
            // Give time for same-tab nav or new-tab to open (whichever applies)
            await Promise.race([navSameTab, sleep(8000)]);
            await sleep(2000);

            // Check all open tabs — the returns site may have opened in a new one
            const allTabs = await browser.pages();
            for (const tab of allTabs) {
                if (this.isOnReturnsSite(tab.url())) {
                    console.log(`[GSP Puppeteer] Found returns site in tab: ${tab.url()}`);
                    if (await this.waitForPeriodSelectors(tab, 14000)) return tab;
                }
            }
            // Also check same page (in case it navigated in-place)
            if (this.isOnReturnsSite(page.url())) {
                if (await this.waitForPeriodSelectors(page, 14000)) return page;
            }
        }

        // Strategy 2: Services > Returns > Returns Dashboard menu path
        await this.navigateToPortalDashboard(page);
        const svcClicked = await this.clickMatchingAction(page, ['services']);
        if (svcClicked) { await sleep(1000); }
        const retClicked = await this.clickMatchingAction(page, ['returns']);
        if (retClicked) { await sleep(1000); }

        const navMenu = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => null);
        const dashClicked = await this.clickMatchingAction(page, ['returns dashboard', 'return dashboard']);
        if (dashClicked) {
            await Promise.race([navMenu, sleep(8000)]);
            await sleep(2000);
            const allTabs2 = await browser.pages();
            for (const tab of allTabs2) {
                if (this.isOnReturnsSite(tab.url())) {
                    if (await this.waitForPeriodSelectors(tab, 14000)) return tab;
                }
            }
            if (this.isOnReturnsSite(page.url())) {
                if (await this.waitForPeriodSelectors(page, 14000)) return page;
            }
        }

        // Strategy 3: Direct URL navigation (last resort, may be rejected without prior button click)
        await this.gotoWithRetry(page, GST_RETURN_DASHBOARD_URL, { waitUntil: 'networkidle2', timeout: 30000 }, 2).catch(() => null);
        await sleep(3000);
        if (await this.waitForPeriodSelectors(page, 8000)) return page;

        // Capture screenshot + HTML for debugging
        await this.captureDebugArtifacts(page, sessionKey, username, `return-nav-failed-${returnType}-${period}`);
        const diag = await this.getPageDiagnostics(page);
        throw this.createTaggedError(
            `GST return dashboard not reachable. URL: ${diag.url} | Title: ${diag.title || 'untitled'} | Visible actions: ${diag.actions.slice(0, 8).join(', ') || 'none'}`,
            'RETURN_PAGE_NOT_FOUND'
        );
    }

    async isLoggedIn(page) {
        const url = page.url();
        const authenticatedUrlPatterns = [
            '/services/auth/fowelcome',
            '/services/auth/dashboard',
            '/services/auth/myprofile',
            '/returns/auth/dashboard',
            '/returns/auth/ledger/',
            '/returns2/auth/'
        ];

        if (authenticatedUrlPatterns.some((pattern) => url.includes(pattern))) {
            return true;
        }

        return page.evaluate(() => {
            const text = document.body?.innerText?.toLowerCase() || '';
            return (
                text.includes('welcome vijaykumar') ||
                text.includes('welcome ') ||
                text.includes('my returns dashboard') ||
                text.includes('file returns') ||
                text.includes('return dashboard')
            );
        }).catch(() => false);
    }

    formatPortalMonth(period) {
        const month = parseInt(String(period).slice(0, 2), 10);
        const months = {
            4: 'April',
            5: 'May',
            6: 'June',
            7: 'July',
            8: 'August',
            9: 'September',
            10: 'October',
            11: 'November',
            12: 'December',
            1: 'January',
            2: 'February',
            3: 'March'
        };
        return months[month] || null;
    }

    formatFinancialYear(period) {
        const month = parseInt(String(period).slice(0, 2), 10);
        const year = parseInt(String(period).slice(2), 10);

        if (!month || !year) return null;
        return month <= 3
            ? `${year - 1}-${String(year).slice(-2)}`
            : `${year}-${String(year + 1).slice(-2)}`;
    }

    formatPortalQuarter(period) {
        const month = parseInt(String(period).slice(0, 2), 10);
        if (!month) return null;

        if ([4, 5, 6].includes(month)) return 'Quarter 1';
        if ([7, 8, 9].includes(month)) return 'Quarter 2';
        if ([10, 11, 12].includes(month)) return 'Quarter 3';
        return 'Quarter 4';
    }

    async selectDropdownByText(page, selector, desiredText) {
        const result = await page.evaluate((sel, desired) => {
            const select = document.querySelector(sel);
            if (!select) {
                return { ok: false, reason: `Selector not found: ${sel}` };
            }

            const normalizedDesired = desired.toLowerCase();
            const options = Array.from(select.options || []).map((option) => ({
                value: option.value,
                text: (option.textContent || '').replace(/\s+/g, ' ').trim()
            }));

            const exact = options.find((option) => option.text.toLowerCase() === normalizedDesired);
            const startsWith = options.find((option) => option.text.toLowerCase().startsWith(normalizedDesired));
            const contains = options.find((option) => option.text.toLowerCase().includes(normalizedDesired));
            const choice = exact || startsWith || contains;

            if (!choice) {
                return {
                    ok: false,
                    reason: `No option matched "${desired}"`,
                    options: options.map((option) => option.text)
                };
            }

            select.value = choice.value;
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, selected: choice.text };
        }, selector, desiredText);

        if (!result.ok) {
            throw new Error(result.reason);
        }

        return result.selected;
    }

    async selectReturnPeriod(page, period) {
        const fy = this.formatFinancialYear(period);
        const quarter = this.formatPortalQuarter(period);
        const monthName = this.formatPortalMonth(period);

        if (!fy || !quarter || !monthName) {
            throw new Error(`Invalid period format: ${period}. Expected MMYYYY.`);
        }

        const finSelector = await page.evaluate(() => {
            const fin = document.querySelector('#fin, select[name="fin"], select[id*="fin"]');
            if (fin?.id) return `#${fin.id}`;
            if (fin?.getAttribute('name')) return `select[name="${fin.getAttribute('name')}"]`;
            return null;
        }).catch(() => null);

        const quarterSelector = await page.evaluate(() => {
            const quarter = document.querySelector('#quarter, select[name="quarter"], select[id*="quarter"]');
            if (quarter?.id) return `#${quarter.id}`;
            if (quarter?.getAttribute('name')) return `select[name="${quarter.getAttribute('name')}"]`;
            return null;
        }).catch(() => null);

        const periodSelector = await page.evaluate(() => {
            const periodSelect = document.querySelector('#period, select[name="period"], select[name="mon"], select[id*="period"]');
            if (periodSelect?.id) return `#${periodSelect.id}`;
            if (periodSelect?.getAttribute('name')) return `select[name="${periodSelect.getAttribute('name')}"]`;
            return null;
        }).catch(() => null);

        const resolvedFinSelector = finSelector || 'select[name="fin"], #fin';
        const resolvedQuarterSelector = quarterSelector || 'select[name="quarter"], #quarter';
        const resolvedPeriodSelector = periodSelector || 'select[name="mon"], select[name="period"], #period';

        await page.waitForSelector(resolvedFinSelector, { timeout: 8000 });
        await this.selectDropdownByText(page, resolvedFinSelector, fy);
        await sleep(1200);

        const quarterExists = await page.$(resolvedQuarterSelector);
        if (quarterExists) {
            await this.selectDropdownByText(page, resolvedQuarterSelector, quarter);
            await sleep(1200);
        }

        await page.waitForSelector(resolvedPeriodSelector, { timeout: 8000 });
        await this.selectDropdownByText(page, resolvedPeriodSelector, monthName);
        await sleep(600);

        const searchButton = await page.$('#search, button[id="search"], input[id="search"], .srchbtn');
        if (searchButton) {
            await searchButton.click();
            await sleep(2500);
            return;
        }

        const textClicked = await this.clickMatchingAction(page, ['search']);
        if (textClicked) {
            await sleep(2500);
            return;
        }

        throw new Error('Search button not found on GST return dashboard');
    }

    async extractReturnSummary(page, returnType, period) {
        return page.evaluate((rt, p) => {
            const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
            const parseAmount = (value) => {
                if (value == null) return null;
                const cleaned = String(value).replace(/[,Rs.\s₹]/gi, '');
                const numeric = Number(cleaned);
                return Number.isFinite(numeric) ? numeric : null;
            };

            const bodyText = document.body?.innerText || '';
            const candidateCards = Array.from(document.querySelectorAll('div, section, article'))
                .map((element) => {
                    const text = normalize(element.textContent);
                    if (!text) return null;
                    if (!text.toUpperCase().includes(rt.toUpperCase())) return null;

                    const buttons = Array.from(element.querySelectorAll('a,button'))
                        .map((button) => normalize(button.textContent || button.value))
                        .filter(Boolean);

                    const titleNode = element.querySelector('h1,h2,h3,h4,h5,strong,.card-title,.retTitle,.ret-heading');
                    const dueDateMatch = text.match(/Due Date\s*-\s*([0-9/.-]+)/i);
                    const arnMatch = text.match(/\bARN\b[:\s-]*([A-Z0-9]+)/i);
                    const statusMatch = text.match(/\b(FILED|NOT FILED|SUBMITTED|GENERATED|AVAILABLE|PENDING)\b/i);

                    return {
                        text,
                        title: normalize(titleNode?.textContent) || null,
                        buttons,
                        dueDate: dueDateMatch ? dueDateMatch[1] : null,
                        arn: arnMatch ? arnMatch[1] : null,
                        status: statusMatch ? statusMatch[1].toUpperCase() : null
                    };
                })
                .filter(Boolean)
                .sort((a, b) => b.text.length - a.text.length);

            const matchedCard = candidateCards.find((card) => card.buttons.length > 0) || candidateCards[0] || null;
            const rows = Array.from(document.querySelectorAll('tr')).map(row => {
                const cells = Array.from(row.querySelectorAll('th,td')).map(cell => normalize(cell.textContent));
                return {
                    text: normalize(row.textContent),
                    cells
                };
            });

            const targetRow = rows.find(row => row.text.toUpperCase().includes(rt.toUpperCase()));
            const matchedNumbers = targetRow?.cells
                ?.map(cell => parseAmount(cell))
                .filter(value => value != null) || [];
            const invoiceCell = targetRow?.cells?.find(cell => /invoice/i.test(cell));
            const invoiceCount = invoiceCell
                ? parseAmount(invoiceCell)
                : (targetRow?.cells || [])
                    .map(cell => parseAmount(cell))
                    .find(value => Number.isInteger(value) && value >= 0) ?? null;

            const pageNumbers = Array.from(bodyText.matchAll(/(?:₹|Rs\.?\s*)?([0-9][0-9,]*\.?[0-9]*)/g))
                .map(match => parseAmount(match[1]))
                .filter(value => value != null);

            const title = normalize(document.title);

            return {
                gstin: null,
                returnType: rt,
                period: p,
                invoices: [],
                summary: {
                    status: matchedCard?.status || targetRow?.cells?.find(cell => /filed|submitted|not filed|generated|available/i.test(cell)) || null,
                    invoiceCount: matchedCard ? null : invoiceCount,
                    totalTaxableValue: matchedNumbers[0] ?? null,
                    totalIGST: matchedNumbers[1] ?? null,
                    totalCGST: matchedNumbers[2] ?? null,
                    totalSGST: matchedNumbers[3] ?? null,
                    dueDate: matchedCard?.dueDate || null,
                    source: matchedCard
                        ? 'GST Portal return card'
                        : targetRow
                            ? 'GST Portal dashboard row'
                            : 'GST Portal page scan'
                },
                meta: {
                    pageTitle: title,
                    url: location.href,
                    matchedCard,
                    availableActions: matchedCard?.buttons || [],
                    matchedRow: targetRow?.cells || [],
                    visibleNumberCount: pageNumbers.length
                }
            };
        }, returnType, period);
    }

    /**
     * Public Search GSTIN
     * Fetches basic info like legal name and status
     */
    async verifyGSTIN(gstin) {
        const version = "v1.2-scraper-fix";
        const providerHex = Buffer.from(this.provider).toString('hex');
        console.log(`[GSP ${version}] verifyGSTIN called for ${gstin} | Provider: "${this.provider}" (hex: ${providerHex})`);

        if (this.provider.includes('MOCK')) {
            console.log(`[GSP Mock] Verifying ${gstin}`);
            await new Promise(r => setTimeout(r, 1000));
            return {
                gstin,
                legalName: "Mock GST Business Ltd",
                tradeName: "Mock Trading",
                status: "ACTIVE",
                state: "Maharashtra"
            };
        }

        if (this.provider.includes('PUPPETEER')) {
            console.log(`[GSP Puppeteer] Scraping details for ${gstin}`);
            let browser;
            try {
                browser = await this.launchBrowser(`gstin_lookup_${gstin}`, gstin);
                const page = await this.createPage(browser);

                // Navigate directly to the details page
                await page.goto(`https://razorpay.com/gst-number-search/${gstin}/`, {
                    waitUntil: 'networkidle2',
                    timeout: 45000
                });

                // Wait for the business details section or any h2 result
                await page.waitForSelector('section#business-details, h2', { timeout: 15000 });

                const data = await page.evaluate(() => {
                    const findByLabel = (labelPattern) => {
                        const divs = Array.from(document.querySelectorAll('div, span, p'));
                        const labelEl = divs.find(el =>
                            el.textContent.trim().toLowerCase().includes(labelPattern.toLowerCase()) &&
                            el.children.length === 0
                        );

                        if (labelEl) {
                            // Try sibling first
                            let next = labelEl.nextElementSibling;
                            if (next && next.textContent.trim()) return next.textContent.trim();

                            // Try parent context (often label and value are in same parent or siblings of parent)
                            const parent = labelEl.parentElement;
                            if (parent) {
                                const siblings = Array.from(parent.children);
                                const idx = siblings.indexOf(labelEl);
                                if (idx !== -1 && siblings[idx + 1]) {
                                    return siblings[idx + 1].textContent.trim();
                                }
                                // Maybe valid is the last child of the same parent
                                const last = parent.lastElementChild;
                                if (last !== labelEl) return last.textContent.trim();
                            }
                        }
                        return null;
                    };

                    const legalName = findByLabel('Legal Name of Business');
                    const status = findByLabel('GSTIN Status');
                    const state = findByLabel('State Jurisdiction') || findByLabel('Principal Place of Business');

                    return {
                        legalName,
                        status,
                        state
                    };
                });

                console.log(`[GSP Puppeteer] Extracted Data: ${JSON.stringify(data)}`);

                // Clean up legal name (filter out Razorpay ads)
                let legalName = data.legalName || "Unknown Business";
                if (legalName.toLowerCase().includes('razorpay') || legalName.length > 100) {
                    legalName = "Unknown Business";
                }

                // Simple state code mapping
                const stateCodes = {
                    '27': 'Maharashtra', '07': 'Delhi', '29': 'Karnataka', '33': 'Tamil Nadu',
                    '09': 'Uttar Pradesh', '24': 'Gujarat', '19': 'West Bengal', '32': 'Kerala',
                    '36': 'Telangana', '37': 'Andhra Pradesh'
                };
                const prefix = gstin.substring(0, 2);
                const derivedState = stateCodes[prefix] || "Unknown";

                return {
                    gstin: gstin,
                    legalName: legalName,
                    tradeName: legalName,
                    status: data.status || 'ACTIVE',
                    state: data.state || derivedState
                };
            } catch (err) {
                console.error(`[GSP Puppeteer] Error: ${err.message}`);
                throw new Error(`Browser automation failed: ${err.message}`);
            } finally {
                if (browser) await browser.close();
            }
        }

        if (this.provider.includes('SANDBOX')) {
            console.log(`[GSP Sandbox] Verifying ${gstin}`);
            try {
                const payload = await this.sandboxRequest('POST', GST_PUBLIC_SEARCH_GSTIN_PATH, {
                    body: { gstin },
                    acceptCache: true
                });
                console.log(`[GSP Sandbox] Raw Response: ${JSON.stringify(payload)}`);

                const result = this.unwrapSandboxData(payload);

                return {
                    gstin: result.gstin || gstin,
                    legalName: result.lgnm || result.legal_name || "Unknown Business",
                    tradeName: result.tradeNam || result.trade_name || result.lgnm || "—",
                    status: result.sts || result.status || 'ACTIVE',
                    state: result.pradr?.addr?.stcd || result.prbs?.state || result.state || null,
                    taxpayerType: result.dty || result.taxpayerType || null,
                    address: result.pradr?.addr || null
                };
            } catch (err) {
                console.error(`GSP Sandbox Error: ${err.message}`);
                throw err;
            }
        }

        throw new Error(`Unsupported GSP provider: ${this.provider}`);
    }

    /**
     * Step 1: Request OTP from GST Portal
     */
    async requestOTP(username, password, sessionKey, options = {}) {
        console.log(`[GSP] requestOTP for ${username} with provider ${this.provider}`);

        if (this.provider.includes('MOCK')) {
            await new Promise(r => setTimeout(r, 800));
            return {
                transactionId: "mock_tx_" + Date.now(),
                message: "OTP sent to registered mobile (mock provider)",
                nextStep: "OTP",
                // lightweight placeholder so the UI doesn't block when it expects a captcha image
                captcha: Buffer.from('MOCK').toString('base64')
            };
        }

        if (this.provider.includes('PUPPETEER')) {
            console.log(`[GSP Puppeteer] Initiating login flow for ${username}`);
            let browser;
            let page;
            let keepSessionOpen = false;
            try {
                await this.releaseActiveSession(sessionKey);
                await this.clearSession(sessionKey, username);
                browser = await this.launchBrowser(sessionKey, username);
                page = await this.createPage(browser);

                await this.gotoWithRetry(page, GST_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });

                await page.waitForSelector('#username');
                await page.type('#username', username);
                if (password) await page.type('#user_pass', password);

                // GST renders captcha only after the initial credential submit.
                const submitButton = await page.$('button[type="submit"], #login');
                if (!submitButton) {
                    throw new Error('Login submit button not found on GST portal');
                }

                await submitButton.click();
                await page.waitForSelector('#captcha, #imgCaptcha', { timeout: 15000 });

                // Wait for the captcha image src to be populated before screenshotting
                await page.waitForFunction(
                    () => {
                        const img = document.querySelector('#imgCaptcha') || document.querySelector('img[src*="/captcha"]');
                        return img && img.src && img.src.length > 0 && !img.src.endsWith('/captcha');
                    },
                    { timeout: 8000 }
                ).catch(() => null);

                const captchaElement = await page.$('#imgCaptcha') || await page.$('img[src*="/captcha"]');
                let captchaBase64 = null;
                if (captchaElement) {
                    captchaBase64 = await captchaElement.screenshot({ encoding: "base64" });
                }

                if (!captchaBase64) {
                    throw this.createTaggedError('GST portal captcha could not be captured', 'CAPTCHA_CAPTURE_FAILED');
                }

                this.rememberActiveSession(sessionKey, username, browser, page);
                keepSessionOpen = true;

                return {
                    transactionId: this.getSessionKey(sessionKey, username),
                    message: "Credentials accepted. Please solve the GST portal CAPTCHA to continue.",
                    captcha: captchaBase64
                };
            } catch (err) {
                if (page) {
                    await this.captureDebugArtifacts(page, sessionKey, username, 'request-otp-error');
                }
                console.error(`[GSP Puppeteer] OTP Request Error: ${err.message}`);
                throw new Error(`Browser automation failed to initiate: ${err.message}`);
            } finally {
                if (browser && !keepSessionOpen) {
                    await browser.close();
                }
            }
        }

        if (this.provider.includes('SANDBOX')) {
            try {
                if (!options.gstin) {
                    throw new Error('GSTIN is required for Sandbox taxpayer authentication');
                }

                const payload = await this.sandboxRequest('POST', GST_TAXPAYER_OTP_PATH, {
                    body: {
                        username,
                        gstin: options.gstin
                    }
                });

                return {
                    transactionId: payload.transaction_id || this.getSessionKey(sessionKey, username),
                    nextStep: 'OTP',
                    message: "OTP sent to the GST-registered mobile number"
                };
            } catch (err) {
                console.error(`[GSP Sandbox] OTP Request Error: ${err.message}`);
                throw err;
            }
        }

        throw new Error(`OTP Request not supported for provider: ${this.provider}`);
    }

    /**
     * Step 2: Verify OTP and Establish Session
     */
    async verifyOTP(username, password, otp, transactionId, captcha, options = {}) {
        console.log(`[GSP] verifyOTP for ${username} with provider ${this.provider}`);

        if (this.provider.includes('MOCK')) {
            await new Promise(r => setTimeout(r, 1000));
            return { success: true, message: "Portal connection established" };
        }

        if (this.provider.includes('PUPPETEER')) {
            console.log(`[GSP Puppeteer] Completing login for ${username}`);
            let browser;
            let page;
            let keepSessionOpen = false;
            try {
                const activeSession = this.getActiveSession(transactionId, username);

                if (activeSession) {
                    if (Date.now() - activeSession.createdAt > CAPTCHA_SESSION_TTL_MS) {
                        await this.releaseActiveSession(transactionId, { preserveProfile: false });
                        throw this.createTaggedError(
                            'GST CAPTCHA expired before verification. Reload the CAPTCHA and try again.',
                            'CAPTCHA_EXPIRED'
                        );
                    }

                    browser = activeSession.browser;
                    page = activeSession.page;
                    keepSessionOpen = true;
                } else {
                    // No active session — start a fresh browser and fill credentials from scratch
                    browser = await this.launchBrowser(transactionId, username);
                    page = await this.createPage(browser);
                    await this.gotoWithRetry(page, GST_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });
                    if (await page.$('#username')) {
                        await page.$eval('#username', el => { el.value = ''; });
                        await page.type('#username', username);
                    }
                    if (await page.$('#user_pass')) {
                        await page.$eval('#user_pass', el => { el.value = ''; });
                        await page.type('#user_pass', password);
                    }
                    // Submit credentials so the captcha step appears
                    const credSubmit = await page.$('button[type="submit"], #login, input[type="submit"]');
                    if (credSubmit) {
                        await credSubmit.click();
                        await page.waitForSelector('#captcha, #imgCaptcha', { timeout: 15000 });
                    }
                }

                // At this point the browser is on the captcha step — only fill the captcha field
                if (captcha) {
                    await page.waitForSelector('#captcha', { timeout: 10000 });
                    await page.$eval('#captcha', el => { el.value = ''; });
                    await page.type('#captcha', captcha);
                }

                const submitButton = await page.$('button[type="submit"], #login, input[type="submit"]');
                if (submitButton) {
                    await submitButton.click();
                    // Wait for navigation only — success/error detection is handled by waitForPortalLogin below
                    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => null);
                }

                const url = page.url();
                if (url.includes('otp')) {
                    // We are on the OTP page
                    if (otp) {
                        await page.waitForSelector('#otp');
                        await page.type('#otp', otp);
                        await page.click('button[type="submit"]');
                        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null);
                    } else {
                        return { success: false, requiresOTP: true, message: "OTP required", nextStep: 'OTP' };
                    }
                }

                const authenticated = await this.waitForPortalLogin(page, 8000);
                if (!authenticated) {
                    throw this.createTaggedError(
                        'GST portal did not finish login after CAPTCHA submission. Please retry with a fresh CAPTCHA.',
                        'LOGIN_NOT_COMPLETED'
                    );
                }

                await this.navigateToPortalDashboard(page);
                const finalUrl = page.url();
                const isDashboard = await this.isLoggedIn(page);

                 await this.releaseActiveSession(transactionId);
                 keepSessionOpen = false;

                return {
                    success: isDashboard,
                    message: isDashboard ? "Success: Logged into GST Portal" : "Login failed - check credentials/captcha",
                    url: finalUrl
                };
            } catch (err) {
                if (page) {
                    await this.captureDebugArtifacts(page, transactionId, username, 'verify-otp-error');
                }
                console.error(`[GSP Puppeteer] Login Completion Error: ${err.message}`);
                throw new Error(`Browser automation failed to complete login: ${err.message}`);
            } finally {
                if (browser && !keepSessionOpen) {
                    await browser.close().catch(() => null);
                }
            }
        }

        if (this.provider.includes('SANDBOX')) {
            try {
                if (!otp) {
                    return { success: false, requiresOTP: true, message: 'OTP required', nextStep: 'OTP' };
                }
                if (!options.gstin) {
                    throw new Error('GSTIN is required for Sandbox taxpayer verification');
                }

                const payload = await this.sandboxRequest('POST', GST_TAXPAYER_VERIFY_OTP_PATH, {
                    query: { otp },
                    body: { username, gstin: options.gstin }
                });
                const data = this.unwrapSandboxData(payload);

                return {
                    success: true,
                    message: "Sandbox taxpayer session established",
                    expiry: data?.session_expiry || data?.token_expiry || null,
                    accessToken: data?.access_token || null
                };
            } catch (err) {
                console.error(`[GSP Sandbox] OTP Verify Error: ${err.message}`);
                throw err;
            }
        }

        throw new Error(`OTP Verification not supported for provider: ${this.provider}`);
    }

    /**
     * Step 3: Download Return Data (GSTR-1, 2A, 2B, 3B)
     */
    async downloadReturn({ username, gstin, returnType, period, password, sessionKey }) {
        console.log(`[GSP] downloadReturn ${returnType} for ${username || gstin} period ${period}`);

        if (this.provider.includes('MOCK')) {
            await new Promise(r => setTimeout(r, 1500));
            return {
                gstin: "MOCK_GSTIN", returnType, period, invoices: [],
                summary: { totalTaxableValue: Math.round(Math.random() * 100000), totalIGST: Math.round(Math.random() * 18000), totalCGST: 0, totalSGST: 0 }
            };
        }

        if (this.provider.includes('PUPPETEER')) {
            console.log(`[GSP Puppeteer] Starting return download for ${returnType} in ${period}`);
            let browser;
            let activePage;
            try {
                browser = await this.launchBrowser(sessionKey, username);
                const mainPage = await this.createPage(browser);

                await this.navigateToPortalDashboard(mainPage);

                // navigateToReturnWorkspace returns the page that has the period selectors
                // (may be a new tab if the portal opens return.gst.gov.in in a new window)
                activePage = await this.navigateToReturnWorkspace(browser, mainPage, returnType, period, sessionKey, username);
                await this.selectReturnPeriod(activePage, period);
                const extracted = await this.extractReturnSummary(activePage, returnType, period);

                return {
                    ...extracted,
                    gstin: username,
                    meta: {
                        ...extracted.meta,
                        timestamp: new Date().toISOString()
                    }
                };
            } catch (err) {
                if (activePage) {
                    await this.captureDebugArtifacts(activePage, sessionKey, username, `download-error-${returnType}-${period}`);
                }
                console.error(`[GSP Puppeteer] Download Error: ${err.message}`);
                const wrapped = new Error(`Browser automation failed to download return: ${err.message}`);
                wrapped.code = err.code || 'DOWNLOAD_FAILED';
                throw wrapped;
            } finally {
                if (browser) await browser.close();
            }
        }

        if (this.provider.includes('SANDBOX')) {
            try {
                if (!gstin) {
                    throw new Error('GSTIN is required to track GST returns via Sandbox');
                }

                return await this.trackSandboxReturns(gstin, period, returnType, true);
            } catch (err) {
                console.error(`[GSP Sandbox] Download Error: ${err.message}`);
                throw err;
            }
        }

        throw new Error(`Return download not supported for provider: ${this.provider}`);
    }
}

module.exports = GSPService;
