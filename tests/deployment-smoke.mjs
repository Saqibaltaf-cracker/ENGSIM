import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4173/ENGSIM/');
assert(['http:', 'https:'].includes(base.protocol), 'BASE_URL must be HTTP or HTTPS.');
if (!base.pathname.endsWith('/')) base.pathname += '/';
const isLocalAsset = (url) => {
  const parsed = new URL(url);
  return (
    parsed.origin === base.origin &&
    /\.(?:js|css|svg)(?:$|\?)/.test(parsed.pathname + parsed.search)
  );
};
async function waitFor(check, predicate, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let latest;
  do {
    latest = await check();
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.fail(`${description}; last observation: ${JSON.stringify(latest)}`);
}

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROMIUM_PATH ||
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const failedAssets = [];
  const assetUrls = new Set();
  context.on('response', (response) => {
    const url = response.url();
    if (isLocalAsset(url)) {
      assetUrls.add(url);
      if (response.status() >= 400) failedAssets.push(`${response.status()} ${url}`);
    }
  });
  context.on('requestfailed', (request) => {
    if (isLocalAsset(request.url()))
      failedAssets.push(`${request.failure()?.errorText || 'request failed'} ${request.url()}`);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.__engineLabWorkletUrls = [];
    if (typeof Worklet !== 'undefined') {
      const addModule = Worklet.prototype.addModule;
      Worklet.prototype.addModule = function (moduleUrl, options) {
        window.__engineLabWorkletUrls.push(new URL(moduleUrl, location.href).href);
        return addModule.call(this, moduleUrl, options);
      };
    }
    const original = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function () {
      const node = original.call(this);
      window.__engineLabAnalyser = node;
      return node;
    };
  });

  const response = await page.goto(base.href, { waitUntil: 'networkidle' });
  assert(response?.ok(), `Production document failed: ${response?.status()}`);
  const html = await response.text();
  assert(
    !html.includes('/@vite/client'),
    'Expected production build, received Vite development HTML.',
  );
  const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|svg)(?:\?[^"]*)?)"/g)].map(
    (match) => new URL(match[1], base),
  );
  assert(
    assetPaths.some((url) => url.pathname.endsWith('.js')),
    'No production JS module found.',
  );
  assert(
    assetPaths.some((url) => url.pathname.endsWith('favicon.svg')),
    'Favicon missing.',
  );
  for (const url of assetPaths) {
    assert.equal(url.origin, base.origin, `Unexpected external application asset: ${url.href}`);
    assert(url.pathname.startsWith(base.pathname), `Asset escaped deployment subpath: ${url.href}`);
    const resource = await context.request.get(url.href);
    assert(resource.ok(), `Static asset failed: ${resource.status()} ${url.href}`);
    assert(
      !(resource.headers()['content-type'] || '').includes('text/html'),
      `Asset returned fallback HTML: ${url.href}`,
    );
  }
  const workletUrl = new URL('engine-processor.js', base);
  const worklet = await context.request.get(workletUrl.href);
  assert(worklet.ok(), `AudioWorklet asset failed: ${worklet.status()}`);
  assert(
    (await worklet.text()).includes('registerProcessor'),
    'AudioWorklet response was not processor JavaScript.',
  );

  await page.getByRole('heading', { name: 'Simulation workspace' }).waitFor();
  const rpm = async () =>
    Number(
      (await page.locator('.tachometer').getAttribute('aria-label'))
        ?.match(/[\d,]+/)?.[0]
        .replaceAll(',', ''),
    );
  assert.equal(await rpm(), 0, 'New session must begin with engine off.');
  await page.getByRole('button', { name: /Start engine/ }).click();
  await waitFor(rpm, (value) => value > 600 && value < 1400, 'Engine did not settle near idle.');
  await page.waitForTimeout(1800);
  const idleRpm = await rpm();
  assert(idleRpm > 600 && idleRpm < 1400, `Unstable idle: ${idleRpm} RPM`);
  await page.getByRole('button', { name: /Enable engine audio/ }).click();
  const audioRms = async () =>
    page.evaluate(() => {
      const analyser = window.__engineLabAnalyser;
      if (!analyser) return 0;
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    });
  const measuredRms = await waitFor(
    audioRms,
    (value) => Number.isFinite(value) && value > 0.001,
    'Actual AudioWorklet output was silent.',
  );
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.down('w');
  const revRpm = await waitFor(rpm, (value) => value > 2500, 'Throttle did not increase RPM.');
  await page.keyboard.up('w');
  await page.getByRole('button', { name: /Stop engine/ }).click();
  await waitFor(rpm, (value) => value < 20, 'Engine did not spin down.');
  await waitFor(audioRms, (value) => value < 0.001, 'Audio did not silence after stopping.');

  const workerAssets = [...assetUrls].filter((url) => /simulation\.worker[^/]*\.js/.test(url));
  const workletCalls = await page.evaluate(() => window.__engineLabWorkletUrls || []);
  const requestedWorklet = [...assetUrls, ...workletCalls].some((url) => url === workletUrl.href);
  assert(workerAssets.length > 0, 'No production simulation worker was requested.');
  assert(requestedWorklet, 'No actual AudioWorklet module request was observed.');
  for (const url of [...workerAssets, workletUrl.href])
    assert(
      new URL(url).pathname.startsWith(base.pathname),
      `Worker/worklet escaped deployment subpath: ${url}`,
    );
  assert.deepEqual(errors, [], 'Browser page or console errors.');
  assert.deepEqual(failedAssets, [], 'Production assets failed to load.');
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        baseUrl: base.href,
        idleRpm,
        revRpm,
        audioRms: measuredRms,
        staticAssets: assetPaths.length,
        workerAssets,
        workletUrl: workletUrl.href,
        browserErrors: errors.length,
        failedAssets: failedAssets.length,
      },
      null,
      2,
    ),
  );
  await context.close();
} finally {
  await browser.close();
}
