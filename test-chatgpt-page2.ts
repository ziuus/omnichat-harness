import { chromium } from 'playwright';
async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const page = await browser.newPage();
  try {
    await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
    console.log('Got to page!');
  } catch(e) {
    console.log('Error:', e.message);
  }
  await browser.close();
}
main().catch(console.error);
