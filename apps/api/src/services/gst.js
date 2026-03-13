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

        if (this.provider === 'SANDBOX') {
            // ... (keep existing SANDBOX code)
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
}

module.exports = GSPService;

