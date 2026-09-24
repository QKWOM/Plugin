// End-to-end test: headless Chromium stands in for Claude Desktop (both expose the
// DevTools protocol), bin/claude-nav.mjs injects the navigator over that port, and
// Playwright drives the page. Run with `npm test`.

import assert from 'node:assert/strict';
import { spawn, spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'plugins/prompt-nav/bin/claude-nav.mjs');
const OUT = path.join(ROOT, 'test/out');
const fixture = (name) => pathToFileURL(path.join(ROOT, 'test/fixtures', name)).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
  }
}

async function waitFor(fn, what, timeout = 10000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

function startProcess(cmd, args, env) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.output = '';
  child.stdout.on('data', (d) => { child.output += d; });
  child.stderr.on('data', (d) => { child.output += d; });
  child.exited = new Promise((r) => child.on('exit', r));
  return child;
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push([true, name]);
    console.log(`  ok  ${name}`);
  } catch (err) {
    results.push([false, name]);
    console.log(`  FAIL ${name}\n       ${err.stack.split('\n').slice(0, 3).join('\n       ')}`);
  }
}

const { chromium } = loadPlaywright();
const port = 9400 + Math.floor(Math.random() * 500);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-nav-test-'));
fs.mkdirSync(OUT, { recursive: true });

const chrome = startProcess(chromium.executablePath(), [
  '--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(home, 'profile')}`,
  '--window-size=1280,800', fixture('claude-like.html'),
]);
let injector;
let browser;

try {
  await waitFor(() => fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok), 'chromium debug port');
  injector = startProcess(process.execPath, [CLI, 'inject', '--port', String(port)], { HOME: home });
  await waitFor(async () => injector.output.includes('已注入'), 'injector to attach');

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  await page.setViewportSize({ width: 1280, height: 800 });
  const status = () => page.evaluate(() => window.claudePromptNav?.status());
  const promptTop = (i, sel) => page.evaluate(([i, sel]) => {
    const el = document.querySelectorAll(sel)[i];
    const sc = document.getElementById('scroll');
    return el.getBoundingClientRect().top - (sc ? sc.getBoundingClientRect().top : 0);
  }, [i, sel]);
  const activeTick = () => page.evaluate(() => {
    const ticks = [...document.querySelector('claude-prompt-nav').shadowRoot.querySelectorAll('.tick')];
    return ticks.findIndex((t) => t.classList.contains('active'));
  });
  const USER = '[data-testid="user-message"]';

  console.log('claude.ai-like page (built-in selector, inner scroll container)');

  await test('detects every prompt automatically', async () => {
    const st = await waitFor(async () => { const s = await status(); return s?.count ? s : null; }, 'prompts');
    assert.equal(st.count, 12);
    assert.equal(st.source, 'auto');
    assert.equal(st.selector, USER);
    assert.equal(await page.locator('claude-prompt-nav .tick').count(), 12);
  });

  await test('rail sits inside the right edge of the conversation', async () => {
    const rail = await page.locator('claude-prompt-nav .rail').boundingBox();
    const sc = await page.locator('#scroll').boundingBox();
    assert.ok(rail, 'rail visible');
    assert.ok(rail.x + rail.width <= sc.x + sc.width && rail.x > sc.x + sc.width - 60, JSON.stringify({ rail, sc }));
    const mid = rail.y + rail.height / 2;
    assert.ok(Math.abs(mid - (sc.y + sc.height / 2)) < 2, 'vertically centred');
  });

  await test('hovering the rail shows every prompt', async () => {
    await page.locator('claude-prompt-nav .rail').hover();
    const panel = page.locator('claude-prompt-nav .panel');
    await panel.waitFor({ state: 'visible' });
    assert.equal(await panel.locator('.item').count(), 12);
    assert.match(await panel.locator('.item').first().innerText(), /EdgeVLA/);
    await page.screenshot({ path: path.join(OUT, 'panel-light.png') });
  });

  await test('clicking a row jumps to that prompt and marks it active', async () => {
    await page.locator('claude-prompt-nav .item').nth(7).click();
    await sleep(900);
    const top = await promptTop(7, USER);
    assert.ok(Math.abs(top - 20) < 4, `prompt 8 top offset ${top}`);
    assert.equal(await activeTick(), 7);
    assert.equal(await page.locator('claude-prompt-nav .panel').isVisible(), false);
  });

  await test('Ctrl+Alt+Down / Up step through prompts', async () => {
    await page.mouse.move(600, 400);
    await page.keyboard.press('Control+Alt+ArrowDown');
    await sleep(900);
    assert.ok(Math.abs((await promptTop(8, USER)) - 20) < 4);
    assert.equal(await activeTick(), 8);
    await page.keyboard.press('Control+Alt+ArrowUp');
    await sleep(700);
    await page.keyboard.press('Control+Alt+ArrowUp');
    await sleep(900);
    assert.ok(Math.abs((await promptTop(6, USER)) - 20) < 4);
    assert.equal(await activeTick(), 6);
  });

  await test('manual scrolling moves the active mark', async () => {
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -100000);
    await sleep(600);
    assert.equal(await activeTick(), 0);
  });

  await test('new prompts appear without reloading', async () => {
    await page.evaluate(() => window.addTurn('刚刚追加的一条提问'));
    await waitFor(async () => (await status()).count === 13, 'the 13th prompt', 3000);
    assert.equal(await page.locator('claude-prompt-nav .tick').count(), 13);
  });

  await test('injecting again does not create a second rail', async () => {
    const once = startProcess(process.execPath, [CLI, 'inject', '--once', '--port', String(port)], { HOME: home });
    assert.equal(await once.exited, 0, once.output);
    assert.equal(await page.evaluate(() => document.querySelectorAll('claude-prompt-nav').length), 1);
  });

  await test('the rail comes back after a reload', async () => {
    await page.reload();
    const st = await waitFor(async () => { const s = await status(); return s?.count ? s : null; }, 'prompts after reload');
    assert.equal(st.count, 12);
  });

  await test('status command reports what each window sees', async () => {
    const st = startProcess(process.execPath, [CLI, 'status', '--port', String(port)], { HOME: home });
    assert.equal(await st.exited, 0, st.output);
    assert.match(st.output, /后台注入器: 运行中/);
    assert.match(st.output, /12 条提问，来源 auto/);
  });

  console.log('unknown markup (picker, dark theme, document scroll)');

  await test('nothing is shown when prompts cannot be recognised', async () => {
    await page.goto(fixture('unknown-dark.html'));
    const st = await waitFor(status, 'script on the new document');
    assert.equal(st.count, 0);
    assert.equal(st.source, 'none');
    assert.equal(await page.locator('claude-prompt-nav .rail').isVisible(), false);
  });

  await test('picking one prompt and one reply teaches it the markup', async () => {
    await page.keyboard.press('Control+Alt+P');
    await page.locator('claude-prompt-nav .banner').waitFor({ state: 'visible' });
    await page.locator('.bubble.human p').nth(2).click(); // 2nd paragraph of the 2nd prompt
    await page.locator('.md p').nth(3).click();
    const st = await waitFor(async () => { const s = await status(); return s?.source === 'custom' ? s : null; }, 'custom selector');
    assert.equal(st.selector, 'div.human');
    assert.equal(st.count, 6);
    assert.equal(await page.locator('claude-prompt-nav .banner').isVisible(), false);
  });

  await test('picker clicks never reach the page', async () => {
    const clicks = await page.evaluate(async () => {
      let n = 0;
      document.addEventListener('click', () => n++);
      window.claudePromptNav.pick();
      document.querySelector('.md p').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return n;
    });
    assert.equal(clicks, 0);
    assert.equal(await page.locator('claude-prompt-nav .banner').isVisible(), false);
  });

  await test('dark pages get the dark theme', async () => {
    assert.equal(await page.locator('claude-prompt-nav').getAttribute('data-theme'), 'dark');
  });

  await test('jumping works when the document itself scrolls', async () => {
    await page.locator('claude-prompt-nav .tick').nth(4).click();
    await sleep(900);
    const top = await page.evaluate(() => document.querySelectorAll('.bubble.human')[4].getBoundingClientRect().top);
    assert.ok(Math.abs(top - 20) < 4, `top ${top}`);
    await page.locator('claude-prompt-nav .rail').hover();
    await page.locator('claude-prompt-nav .panel').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(OUT, 'panel-dark.png') });
  });

  await test('the picked selector is remembered across reloads and can be reset', async () => {
    await page.reload();
    const st = await waitFor(async () => { const s = await status(); return s?.count ? s : null; }, 'prompts after reload');
    assert.equal(st.source, 'custom');
    assert.equal(st.count, 6);
    const reset = await page.evaluate(() => window.claudePromptNav.resetSelector());
    assert.equal(reset.count, 0);
  });

  await test('the injector exits by itself once the app quits', async () => {
    await browser.close().catch(() => {});
    chrome.kill();
    const code = await Promise.race([injector.exited, sleep(15000).then(() => 'still running')]);
    assert.equal(code, 0, injector.output);
    assert.match(injector.output, /Claude 已退出/);
    assert.equal(fs.existsSync(path.join(home, '.claude-prompt-nav', 'injector.pid')), false);
  });

  console.log('start command (fake Claude executable)');
  const fake = path.join(ROOT, 'test/fixtures/fake-claude.sh');
  const fakeEnv = { HOME: home, CHROMIUM: chromium.executablePath(), FIXTURE_URL: fixture('claude-like.html') };
  const port2 = port + 1;
  const run = async (args) => {
    const p = startProcess(process.execPath, [CLI, ...args], fakeEnv);
    const code = await Promise.race([p.exited, sleep(45000).then(() => 'timeout')]);
    return { code, output: p.output };
  };

  await test('start refuses to take over an app already running without the port', async () => {
    startProcess(fake, [], fakeEnv);
    await sleep(1500);
    const r = await run(['start', '--app', fake, '--port', String(port2)]);
    assert.equal(r.code, 1, r.output);
    assert.match(r.output, /已经以普通方式在运行/);
  });

  await test('start --restart --detach relaunches it and leaves an injector running', async () => {
    const r = await run(['start', '--app', fake, '--port', String(port2), '--restart', '--detach']);
    assert.equal(r.code, 0, r.output);
    assert.match(r.output, /注入器在后台运行/);
    const st = await waitFor(async () => {
      const s = await run(['status', '--port', String(port2)]);
      return /12 条提问/.test(s.output) ? s : null;
    }, 'background injector to find the prompts', 20000);
    assert.match(st.output, /后台注入器: 运行中/);
  });

  await test('the background injector stops when the app quits', async () => {
    spawnSync('pkill', ['-TERM', '-f', fake]); // no shell, so pkill cannot match its own parent
    await waitFor(async () => !fs.existsSync(path.join(home, '.claude-prompt-nav', 'injector.pid')), 'pid file removal', 15000);
    assert.match(fs.readFileSync(path.join(home, '.claude-prompt-nav', 'injector.log'), 'utf8'), /Claude 已退出/);
  });
} finally {
  injector?.kill();
  chrome.kill();
  spawnSync('pkill', ['-TERM', '-f', path.join(ROOT, 'test/fixtures/fake-claude.sh')]);
  fs.rmSync(home, { recursive: true, force: true });
}

const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
