import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Simulation workspace' })).toBeVisible();
}
const rpm = async (page: Page) =>
  Number(
    (await page.locator('.tachometer').getAttribute('aria-label'))
      ?.match(/[\d,]+/)?.[0]
      .replaceAll(',', ''),
  );
async function nav(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name, exact: true })
    .click();
}
async function clearFocus(page: Page) {
  await page.getByRole('heading', { level: 1 }).click();
}

// Instrument the real browser analyser to assert non-silent AudioWorklet output.
async function instrumentAudio(page: Page) {
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function () {
      const node = original.call(this);
      (window as unknown as { __audioAnalyser: AnalyserNode }).__audioAnalyser = node;
      return node;
    };
  });
}
async function audioLevel(page: Page) {
  return page.evaluate(() => {
    const analyser = (window as unknown as { __audioAnalyser?: AnalyserNode }).__audioAnalyser;
    if (!analyser) return 0;
    const values = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(values);
    return Math.sqrt(values.reduce((sum, x) => sum + x * x, 0) / values.length);
  });
}

test('starts, idles, revs, pauses and produces actual event-driven audio', async ({ page }) => {
  await instrumentAudio(page);
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  await openApp(page);
  await expect.poll(() => rpm(page)).toBe(0);
  await page.getByRole('button', { name: /Start engine/ }).click();
  await expect(page.locator('.engine-status')).toHaveText('RUNNING');
  await expect.poll(() => rpm(page)).toBeGreaterThan(600);
  await page.waitForTimeout(1600);
  expect(await rpm(page)).toBeLessThan(1400);
  await page.getByRole('button', { name: /Enable engine audio/ }).click();
  await expect(page.getByRole('button', { name: /Audio enabled/ })).toBeVisible();
  await expect.poll(() => audioLevel(page)).toBeGreaterThan(0.001);
  await clearFocus(page);
  await page.keyboard.down('w');
  await expect.poll(() => rpm(page)).toBeGreaterThan(2500);
  await page.keyboard.up('w');
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  const frozen = await rpm(page);
  await page.waitForTimeout(500);
  expect(Math.abs((await rpm(page)) - frozen)).toBeLessThan(50);
  await expect.poll(() => audioLevel(page)).toBeLessThan(0.001);
  await page.screenshot({ path: test.info().outputPath('desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Resume simulation', exact: true }).click();
  await page.getByRole('button', { name: /Stop engine/ }).click();
  await expect.poll(() => rpm(page)).toBeLessThan(20);
  expect(failures).toEqual([]);
});

test('changes presets, saves locally and round-trips JSON', async ({ page }) => {
  await openApp(page);
  await page
    .getByRole('button', { name: /Engine library/ })
    .first()
    .click();
  await page.getByRole('button', { name: /2.0 L Turbo Inline-four/ }).click();
  await expect(page.locator('.engine-ribbon-main')).toContainText('2.0 L Turbo Inline-four');
  await expect(page.getByLabel('Boost target')).toBeVisible();
  await page.getByRole('button', { name: 'Save engine', exact: true }).click();
  await page.getByLabel('Configuration name').fill('QA turbo experiment');
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await page.reload();
  await expect(page.locator('.engine-ribbon-main')).toContainText('QA turbo experiment');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export engine JSON', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('engine-lab-config.json');
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.engine.aspiration).toBe('turbo');
  expect(exported.engine.cylinders).toBe(4);
  exported.engine.name = 'Imported QA engine';
  await page.getByLabel('Import engine configuration').setInputFiles({
    name: 'qa-engine.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.locator('.engine-ribbon-main')).toContainText('Imported QA engine');
  await page
    .getByRole('button', { name: /Engine library/ })
    .first()
    .click();
  await expect(
    page.locator('.preset-card > button').filter({ hasText: 'QA turbo experiment' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Import engine configuration').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"engine":{"bore":-1}}'),
  });
  await expect(page.locator('.toast[role="status"]')).toContainText(/bore|Bore/);
  await expect(page.locator('.engine-ribbon-main')).toContainText('Imported QA engine');
});

test('dyno produces output, supports graph selection and exports real CSV samples', async ({
  page,
}) => {
  await openApp(page);
  await nav(page, 'Dyno');
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  await page.getByRole('button', { name: 'Run dyno sweep' }).click();
  await expect(page.getByText(/SAMPLES · HOVER TO INSPECT/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  const peaks = page.locator('.dyno-summary .stat strong');
  expect(Number((await peaks.nth(0).innerText()).replaceAll(',', ''))).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Boost', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'Boost (bar gauge) versus Engine speed (rpm)' }),
  ).toBeVisible();
  await page.getByLabel('Minimum RPM').fill('1000');
  await page.getByLabel('Minimum RPM').press('Tab');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, 'utf8');
  const rows = csv.split('\n').filter((l) => !l.startsWith('#'));
  expect(rows[0]).toContain('torque_Nm');
  expect(rows.length).toBeGreaterThan(30);
  const data = rows.slice(1).map((r) => r.split(',').map(Number));
  expect(data.every((row) => row.length === 8 && row.every(Number.isFinite))).toBe(true);
  expect(new Set(data.map((row) => row[1])).size).toBeGreaterThan(20);
  await page.screenshot({ path: test.info().outputPath('dyno.png'), fullPage: true });
});

test('automatic drivetrain launches, shifts and responds to brakes', async ({ page }) => {
  await openApp(page);
  await nav(page, 'Drivetrain');
  await page.getByLabel('Transmission mode').selectOption('automatic');
  await page.getByLabel('Automatic upshift').fill('3000');
  await page.getByLabel('Automatic upshift').press('Tab');
  await nav(page, 'Simulation');
  await page.getByRole('button', { name: 'Vehicle', exact: true }).click();
  await page.getByRole('button', { name: /Start engine/ }).click();
  await expect(page.locator('.engine-status')).toHaveText('RUNNING');
  await page.getByRole('button', { name: 'Shift up', exact: true }).click();
  await page.getByRole('slider', { name: 'Throttle', exact: true }).focus();
  await page.keyboard.press('End');
  const speed = async () =>
    Number(
      await page
        .locator('.instrument-stats .stat')
        .filter({ hasText: 'VEHICLE SPEED' })
        .locator('strong')
        .innerText(),
    );
  await expect.poll(speed, { timeout: 15000 }).toBeGreaterThan(15);
  await expect
    .poll(
      async () =>
        Number(
          await page
            .locator('.instrument-stats .stat')
            .filter({ hasText: 'CURRENT GEAR' })
            .locator('strong')
            .innerText(),
        ),
      { timeout: 15000 },
    )
    .toBeGreaterThan(1);
  const before = await speed();
  await page.getByRole('slider', { name: 'Throttle', exact: true }).press('Home');
  await page.getByRole('slider', { name: 'Brake', exact: true }).press('End');
  await expect.poll(speed, { timeout: 10000 }).toBeLessThan(before);
  await page.getByRole('button', { name: 'Neutral', exact: true }).click();
  await expect(page.locator('.gear-controls strong')).toHaveText('N');
});

test('mobile workspace retains controls and all tabs without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  for (const name of ['Simulation', 'Engine', 'Drivetrain', 'Dyno', 'Analysis', 'Settings']) {
    await nav(page, name);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, `${name} horizontal overflow`).toBeLessThanOrEqual(1);
  }
  await nav(page, 'Settings');
  await page.getByLabel('Display units').selectOption('imperial');
  await nav(page, 'Simulation');
  await page.getByRole('button', { name: /Start engine/ }).click();
  await expect.poll(() => rpm(page)).toBeGreaterThan(600);
  await page.getByRole('slider', { name: 'Throttle', exact: true }).focus();
  await page.keyboard.press('End');
  await expect.poll(() => rpm(page)).toBeGreaterThan(2500);
  await page.getByRole('slider', { name: 'Throttle', exact: true }).press('Home');
  await page.screenshot({ path: test.info().outputPath('mobile.png'), fullPage: true });
  await page
    .getByRole('button', { name: /Engine library/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: 'Engine library' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Close dialog' }).click();
});
