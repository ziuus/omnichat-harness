import { chromium } from 'playwright';
async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
  const text = await page.evaluate(() => document.body.innerText);
  console.log('TEXT:', text.substring(0, 500));
  await browser.close();
}
main().catch(console.error);
