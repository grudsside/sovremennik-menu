import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const outputDir = path.join(process.cwd(), 'artifacts', 'live-preview');
const launcherPath = path.join(outputDir, 'preview-launcher.html');
const password = String(process.env.PREVIEW_TEST_PASSWORD || '').trim();
assert(password, 'PREVIEW_TEST_PASSWORD is required.');
await fs.access(launcherPath);

const browser = await chromium.launch({ headless: true });
const checks = [];

async function openAs(login) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error?.message || error)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(pathToFileURL(launcherPath).href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('#login-form input[name="login"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('#login-form input[name="login"]').fill(login);
  await page.locator('#login-form input[name="password"]').fill(password);
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator('.logout-btn').waitFor({ state: 'visible', timeout: 60_000 });

  return { context, page, errors };
}

try {
  {
    const { context, page, errors } = await openAs('preview-admin');
    const tab = page.locator('.main-tab[data-top-target="attestations"]');
    await tab.waitFor({ state: 'visible', timeout: 30_000 });
    await tab.click();
    await page.locator('#top-attestations h2').filter({ hasText: 'Аттестации' }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('button', { name: 'Создать тест' }).waitFor({ state: 'visible', timeout: 30_000 });
    assert(!errors.some(text => /Attestations core is not loaded|ReferenceError|SyntaxError/i.test(text)), `Admin console errors: ${errors.join(' | ')}`);
    checks.push('admin sees and opens Attestations management');
    await context.close();
  }

  {
    const { context, page, errors } = await openAs('preview-barista');
    const tab = page.locator('.main-tab[data-top-target="attestations"]');
    await tab.waitFor({ state: 'visible', timeout: 30_000 });
    await tab.click();
    await page.locator('#top-attestations h2').filter({ hasText: 'Аттестации' }).waitFor({ state: 'visible', timeout: 30_000 });
    assert(!errors.some(text => /Attestations core is not loaded|ReferenceError|SyntaxError/i.test(text)), `Barista console errors: ${errors.join(' | ')}`);
    checks.push('barista sees employee Attestations section');
    await context.close();
  }

  {
    const { context, page, errors } = await openAs('preview-manager');
    await page.locator('.main-tab[data-top-target="attestations"]').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
    assert.equal(await page.locator('.main-tab[data-top-target="attestations"]').count(), 0, 'Manager must not receive a top-level Attestations management tab.');
    await page.locator('.main-tab[data-top-target="control"]').click();
    await page.locator('[data-control-target="attestations"]').waitFor({ state: 'visible', timeout: 30_000 });
    assert(!errors.some(text => /Attestations core is not loaded|ReferenceError|SyntaxError/i.test(text)), `Manager console errors: ${errors.join(' | ')}`);
    checks.push('manager sees Attestations results only in Control');
    await context.close();
  }
} finally {
  await browser.close();
}

await fs.writeFile(
  path.join(outputDir, 'attestations-browser-smoke.json'),
  JSON.stringify({ ok: true, checks, completedAt: new Date().toISOString() }, null, 2),
);
console.log('Live preview Attestations browser smoke passed:', checks.join('; '));
