import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000); // Wait for scripts
  const html = await page.content();
  require('fs').writeFileSync('chatgpt_anonymous.html', html);
  console.log('Saved to chatgpt_anonymous.html');
  await browser.close();
}
main().catch(console.error);