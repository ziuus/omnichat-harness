import { chromium } from 'playwright';
import { getLaunchOptions } from './packages/browser/src/StealthConfig.js';
async function main() {
  const opts = { ...getLaunchOptions(), headless: false };
  console.log('Launch opts:', opts);
  const browser = await chromium.launch(opts);
  const page = await browser.newPage();
  try {
    await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
    const text = await page.evaluate(() => document.body.innerText);
    console.log('TEXT:', text.substring(0, 200));
  } catch(e) {
    console.log('Error:', e.message);
  }
  await browser.close();
}
main().catch(console.error);
