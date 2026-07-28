import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const outputDir = path.join(process.cwd(), 'artifacts', 'live-preview');
const launcherPath = path.join(outputDir, 'preview-launcher.html');
const reportPath = path.join(outputDir, 'attestations-browser-smoke.json');
const password = String(process.env.PREVIEW_TEST_PASSWORD || '').trim();
assert(password, 'PREVIEW_TEST_PASSWORD is required.');
await fs.access(launcherPath);

const browser = await chromium.launch({ headless: true, channel:'chrome' });
const checks = [];
const diagnostics = [];

async function snapshot(page, login, errors) {
  const browserState = await page.evaluate(() => ({
    href: location.href,
    userChip: document.querySelector('.user-chip')?.textContent?.trim() || '',
    tabs: Array.from(document.querySelectorAll('.main-tab')).map(button => ({
      id: button.dataset.topTarget || '',
      text: button.textContent?.trim() || '',
      visible: Boolean(button.offsetWidth || button.offsetHeight || button.getClientRects().length),
    })),
    panels: Array.from(document.querySelectorAll('.top-panel')).map(panel => panel.id),
    guard: window.SovAttestationsTabGuard || null,
    coreLoaded: Boolean(window.SovAttestationsCore),
    readyBankLoaded: Boolean(window.SovAttestationsReadyBank),
    readyBankInstalled: Boolean(window.SovAttestationsCore?.__readyQuestionBankInstalled),
    loadedScripts: Array.from(document.scripts).map(script => script.src).filter(src => /attestations|push\.js/.test(src)),
  }));
  return { login, errors:[...errors], ...browserState };
}

async function openAs(login) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${String(error?.message || error)}`));
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on('requestfailed', request => {
    if (/attestations|push\.js/.test(request.url())) errors.push(`requestfailed: ${request.url()} · ${request.failure()?.errorText || 'unknown'}`);
  });

  await page.goto(pathToFileURL(launcherPath).href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('#login-form input[name="login"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.SovAttestationsCore?.__readyQuestionBankInstalled), null, { timeout: 60_000 });
  await page.locator('#login-form input[name="login"]').fill(login);
  await page.locator('#login-form input[name="password"]').fill(password);
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator('.logout-btn').waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(2500);
  return { context, page, errors };
}

async function runRole(login, verify) {
  const session = await openAs(login);
  try {
    await verify(session.page, session.errors);
    diagnostics.push(await snapshot(session.page, login, session.errors));
  } catch (error) {
    diagnostics.push(await snapshot(session.page, login, session.errors));
    throw error;
  } finally {
    await session.context.close();
  }
}

let failure = null;
try {
  await runRole('preview-admin', async (page, errors) => {
    const bankState = await page.evaluate(() => {
      const built = window.SovAttestationsCore.generateQuestionBank(state.menu || {});
      return {
        installed:Boolean(window.SovAttestationsCore.__readyQuestionBankInstalled),
        total:built.questions.length,
        counts:window.SovAttestationsReadyBank.topicCounts(built.questions),
      };
    });
    assert.equal(bankState.installed, true, 'Ready question bank must be installed before login.');
    assert.equal(bankState.total, 80, 'Ready bank must contain exactly 80 base questions.');
    assert.deepEqual(bankState.counts, { techcards:20, coffee:20, espresso:20, milk:20 });

    await page.waitForFunction(() => Boolean(document.querySelector('.main-tab[data-top-target="attestations"]')), null, { timeout: 60_000 });
    const tab = page.locator('.main-tab[data-top-target="attestations"]');
    await tab.waitFor({ state: 'visible', timeout: 15_000 });
    await tab.click();
    await page.locator('#top-attestations h2').filter({ hasText: 'Аттестации' }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('button', { name: 'Создать тест' }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(() => {
      const values = Array.from(document.querySelectorAll('#top-attestations .att-stat b')).map(node => Number(node.textContent));
      return values.length === 4 && values.every(value => value === 20);
    }, null, { timeout: 60_000 });
    const visibleCounts = await page.locator('#top-attestations .att-stat b').allTextContents();
    assert.deepEqual(visibleCounts.map(value => Number(value)), [20,20,20,20], 'Admin interface must show 20 available questions in each base topic.');
    assert(!errors.some(text => /Attestations core is not loaded|ReferenceError|SyntaxError|requestfailed/i.test(text)), `Admin console errors: ${errors.join(' | ')}`);
    checks.push('admin sees 20 ready questions in each topic and opens Attestations management');
  });

  await runRole('preview-barista', async (page, errors) => {
    await page.waitForFunction(() => Boolean(document.querySelector('.main-tab[data-top-target="attestations"]')), null, { timeout: 60_000 });
    const tab = page.locator('.main-tab[data-top-target="attestations"]');
    await tab.waitFor({ state: 'visible', timeout: 15_000 });
    await tab.click();
    await page.locator('#top-attestations h2').filter({ hasText: 'Аттестации' }).waitFor({ state: 'visible', timeout: 30_000 });
    assert(!errors.some(text => /Attestations core is not loaded|ReferenceError|SyntaxError|requestfailed/i.test(text)), `Barista console errors: ${errors.join(' | ')}`);
    checks.push('barista sees employee Attestations section');
  });

  await runRole('preview-manager', async (page, errors) => {
    assert.equal(await page.locator('.main-tab[data-top-target="attestations"]').count(), 0, 'Manager must not receive a top-level Attestations management tab.');
    await page.locator('.main-tab[data-top-target="control"]').click();
    await page.locator('[data-control-target="attestations"]').waitFor({ state: 'visible', timeout: 30_000 });
    assert(!errors.some(text => /Attestations core is not loaded|ReferenceError|SyntaxError|requestfailed/i.test(text)), `Manager console errors: ${errors.join(' | ')}`);
    checks.push('manager sees Attestations results only in Control');
  });
} catch (error) {
  failure = error instanceof Error ? { name:error.name, message:error.message, stack:error.stack } : { message:String(error) };
} finally {
  await browser.close();
}

await fs.writeFile(reportPath, JSON.stringify({
  ok: !failure,
  checks,
  diagnostics,
  failure,
  completedAt: new Date().toISOString(),
}, null, 2));

if (failure) throw new Error(`Live preview Attestations browser smoke failed: ${failure.message}`);
console.log('Live preview Attestations browser smoke passed:', checks.join('; '));
