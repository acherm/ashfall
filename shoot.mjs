// Screenshot harness: boots vite in-process, drives headless Chromium through the
// shot scenarios, writes PNGs to shots/. Usage: node shoot.mjs [scenario ...]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const SCENARIOS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['street', 'ads', 'combat', 'overview', 'alley', 'soldier', 'fxprobe', 'drive', 'moto', 'truck'];

// PORT + SHOTDIR env vars let several agents run harnesses concurrently
const PORT = +(process.env.PORT || 5199);
const OUT = process.env.SHOTDIR || 'shots';
mkdirSync(OUT, { recursive: true });

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { port: PORT, strictPort: true },
  logLevel: 'error',
});
await server.listen();

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--force-color-profile=srgb'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') console.error(`[console] ${m.text()}`); });

let failed = false;
for (const scen of SCENARIOS) {
  try {
    const mode = scen.startsWith('cr7') ? '&football=1' : '';
    await page.goto(`http://localhost:${PORT}/?shot=1&scenario=${scen}${mode}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${scen}.png` });
    console.log(`ok: ${OUT}/${scen}.png`);
  } catch (e) {
    failed = true;
    console.error(`FAIL ${scen}: ${e.message.split('\n')[0]}`);
    try { await page.screenshot({ path: `${OUT}/${scen}-FAILED.png` }); } catch {}
  }
}

await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
