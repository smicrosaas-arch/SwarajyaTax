const puppeteer = require('puppeteer');

class GSPService {
    constructor(config) {
        this.apiKey = config.apiKey;
        this.secret = config.secret;
        this.provider = (config.provider || 'MOCK').trim().toUpperCase();
        this.baseUrl = config.baseUrl || 'https://api.sandbox.co.in';
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
                browser = await puppeteer.launch({
                    headless: "new",
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-blink-features=AutomationControlled'
                    ]
                });
                const page = await browser.newPage();

                // Set high-quality user agent
                await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

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
                const response = await fetch(`${this.baseUrl}/gsp/public/gstin/${gstin}`, {
                    method: 'GET',
                    headers: {
                        'x-api-key': this.apiKey,
                        'x-api-secret': this.secret,
                        'x-api-version': '1.0',
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    const errText = await response.text();
                    console.error(`[GSP Sandbox] API Error: ${response.status} - ${errText}`);
                    throw new Error(`Sandbox API Error: ${response.status}`);
                }

                const data = await response.json();
                console.log(`[GSP Sandbox] Raw Response: ${JSON.stringify(data)}`);

                const result = data.data || data;

                return {
                    gstin: result.gstin || gstin,
                    legalName: result.lgnm || result.legal_name || "Unknown Business",
                    tradeName: result.tradeNam || result.trade_name || result.lgnm || "—",
                    status: result.sts || result.status || 'ACTIVE',
                    state: result.prbs?.state || result.state || null
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
    async requestOTP(username) {
        console.log(`[GSP] requestOTP for ${username} with provider ${this.provider}`);

        if (this.provider.includes('MOCK')) {
            await new Promise(r => setTimeout(r, 800));
            return { transactionId: "mock_tx_" + Date.now(), message: "OTP sent to registered mobile" };
        }

        if (this.provider.includes('SANDBOX')) {
            try {
                const response = await fetch(`${this.baseUrl}/gsp/authenticate/otp`, {
                    method: 'POST',
                    headers: {
                        'x-api-key': this.apiKey,
                        'x-api-secret': this.secret,
                        'x-api-version': '1.0',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.message || `Sandbox Error: ${response.status}`);

                return {
                    transactionId: data.data?.transaction_id || data.transaction_id,
                    message: data.message || "OTP sent successfully"
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
    async verifyOTP(username, otp, transactionId) {
        console.log(`[GSP] verifyOTP for ${username} with provider ${this.provider}`);

        if (this.provider.includes('MOCK')) {
            await new Promise(r => setTimeout(r, 1000));
            return { success: true, message: "Portal connection established" };
        }

        if (this.provider.includes('SANDBOX')) {
            try {
                const response = await fetch(`${this.baseUrl}/gsp/authenticate/otp/verify`, {
                    method: 'POST',
                    headers: {
                        'x-api-key': this.apiKey,
                        'x-api-secret': this.secret,
                        'x-api-version': '1.0',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username, otp, transaction_id: transactionId })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.message || `Sandbox Error: ${response.status}`);

                return {
                    success: true,
                    message: data.message || "Connection verified",
                    expiry: data.data?.expiry || null
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
    async downloadReturn(username, returnType, period) {
        console.log(`[GSP] downloadReturn ${returnType} for ${username} period ${period}`);

        if (this.provider.includes('MOCK')) {
            await new Promise(r => setTimeout(r, 1500));
            // Return dummy structured data for mock
            return {
                gstin: "MOCK_GSTIN",
                returnType,
                period,
                invoices: [],
                summary: {
                    totalTaxableValue: Math.random() * 100000,
                    totalIGST: Math.random() * 18000,
                    totalCGST: 0,
                    totalSGST: 0
                }
            };
        }

        if (this.provider.includes('SANDBOX')) {
            // Map common types to Sandbox endpoints
            const typeMap = {
                'GSTR1': 'gstr1',
                'GSTR2A': 'gstr2a',
                'GSTR2B': 'gstr2b',
                'GSTR3B': 'gstr3b'
            };

            const endpoint = typeMap[returnType] || returnType.toLowerCase();

            try {
                const response = await fetch(`${this.baseUrl}/gsp/returns/${endpoint}?username=${username}&ret_period=${period}`, {
                    method: 'GET',
                    headers: {
                        'x-api-key': this.apiKey,
                        'x-api-secret': this.secret,
                        'x-api-version': '1.0',
                        'Content-Type': 'application/json'
                    }
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.message || `Sandbox Download Error: ${response.status}`);

                return data.data || data;
            } catch (err) {
                console.error(`[GSP Sandbox] Download Error: ${err.message}`);
                throw err;
            }
        }

        throw new Error(`Return download not supported for provider: ${this.provider}`);
    }
}

module.exports = GSPService;

