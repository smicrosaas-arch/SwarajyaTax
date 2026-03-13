const puppeteer = require('puppeteer');

async function testClearTax() {
    console.log("Launching browser...");
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    const gstin = '27AAACT2727Q1ZW'; // Tata Motors

    console.log(`Navigating to ClearTax for ${gstin}...`);
    try {
        await page.goto(`https://cleartax.in/gst-number-search`, { waitUntil: 'networkidle2' });

        // Let's type in the GSTIN
        await page.type('input[placeholder*="GSTIN"]', gstin);
        await page.click('button:has-text("Search")');

        await page.waitForTimeout(3000);

        const content = await page.content();
        console.log(`Page has ${content.length} characters.`);
        if (content.includes('Tata Motors') || content.includes('TATA MOTORS')) {
            console.log("SUCCESS: Found Tata Motors in the page!");
        } else {
            console.log("FAILED: Did not find company name.");
        }
    } catch (e) {
        console.log("Error:", e.message);
    } finally {
        await browser.close();
    }
}

testClearTax();
