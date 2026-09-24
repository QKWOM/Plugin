#!/usr/bin/env node
// Claude Prompt Nav: launcher and injector for Claude Desktop.
//
// Claude Desktop is an Electron app, so when it is started with
// --remote-debugging-port it speaks the Chrome DevTools Protocol on that
// (localhost-only) port. This script starts Claude that way and keeps
// prompt-nav.user.js injected into every Claude window, including after
// reloads, for as long as Claude is running.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const PKG_ROOT = path.resolve(path.dirname(SELF), '..');
const USER_SCRIPT = path.join(PKG_ROOT, 'prompt-nav.user.js');
const HOME_DIR = path.join(os.homedir(), '.claude-prompt-nav');
const PID_FILE = path.join(HOME_DIR, 'injector.pid');
const LOG_FILE = path.join(HOME_DIR, 'injector.log');
const MAC_LAUNCHER = path.join(os.homedir(), 'Applications', 'Claude Prompt Nav.app');
const DEFAULT_PORT = 9333;

const USAGE = `用法: node claude-nav.mjs [命令] [选项]

命令:
  start      以导航模式启动 Claude 桌面版并持续注入导航条（默认）
  inject     只注入：连接一个已经带调试端口运行的 Claude
  status     查看每个 Claude 窗口里导航条的识别情况
  install    安装到 ~/.claude-prompt-nav 并创建启动器（macOS: ~/Applications/Claude Prompt Nav.app）
  uninstall  删除 install 创建的文件

选项:
  --port <n>   调试端口，默认 ${DEFAULT_PORT}
  --app <路径>  Claude 的安装位置（找不到时使用）
  --restart    Claude 已经以普通方式运行时，先让它退出再以导航模式重新打开（macOS / Linux）
  --detach     启动后把注入器放到后台运行，然后立即返回
  --once       inject 时只注入当前页面，不常驻（刷新后失效）
`;

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { cmd: 'start', port: DEFAULT_PORT, app: null, restart: false, detach: false, once: false };
  const args = [...argv];
  if (args[0] && !args[0].startsWith('-')) opts.cmd = args.shift();
  while (args.length) {
    const arg = args.shift();
    const [flag, inline] = arg.split(/=(.*)/s);
    const value = () => {
      const v = inline ?? args.shift();
      if (v === undefined) throw new UsageError(`${flag} 需要一个值`);
      return v;
    };
    if (flag === '--port') opts.port = Number(value());
    else if (flag === '--app') opts.app = value();
    else if (flag === '--restart') opts.restart = true;
    else if (flag === '--detach') opts.detach = true;
    else if (flag === '--once') opts.once = true;
    else if (flag === '-h' || flag === '--help') opts.cmd = 'help';
    else throw new UsageError(`未知参数: ${arg}`);
  }
  if (!Number.isInteger(opts.port) || opts.port < 1024 || opts.port > 65535) {
    throw new UsageError('--port 必须是 1024-65535 之间的整数');
  }
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...args) {
  const stamp = new Date().toLocaleTimeString();
  console.log(`[prompt-nav ${stamp}]`, ...args);
}

// ------------------------------------------------------------------ CDP

async function getJSON(port, route) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(1500) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const isPortOpen = (port) => getJSON(port, '/json/version').then(() => true, () => false);

class CdpSession {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.onclose = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => resolve(this);
      ws.onerror = () => reject(new Error(`无法连接 ${this.url}`));
      ws.onclose = () => {
        this.closed = true;
        for (const p of this.pending.values()) p.reject(new Error('连接已关闭'));
        this.pending.clear();
        this.onclose?.();
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        const p = msg.id && this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      };
    });
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('连接已关闭'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 超时`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

function isInjectable(target) {
  if (!['page', 'webview'].includes(target.type) || !target.webSocketDebuggerUrl) return false;
  return !/^(devtools|chrome|chrome-extension|chrome-untrusted):/.test(target.url);
}

async function evaluate(session, expression) {
  const r = await session.send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result?.value;
}

const STATUS_EXPR = 'window.claudePromptNav ? window.claudePromptNav.status() : null';

async function reportStatus(session, target) {
  const st = await evaluate(session, STATUS_EXPR).catch(() => null);
  if (!st || target.type !== 'page') return;
  if (st.count > 0) {
    log(`  识别到 ${st.count} 条提问（${st.source === 'custom' ? '你指定的选择器' : '自动识别'}）`);
  } else {
    log('  当前页面还没有识别到提问。打开一段对话后如果仍然没有导航条，');
    log('  在 Claude 窗口里按 Ctrl+Alt+P（Mac 上是 ⌃⌥P），依次点一条你的提问和一条 Claude 的回复即可。');
  }
}

async function attach(target, source, { persistent }) {
  const session = await new CdpSession(target.webSocketDebuggerUrl).connect();
  try {
    // Re-runs the script on every new document (reloads, navigations) while this session stays open.
    // Chromium ignores the registration unless the Page domain is enabled first.
    if (persistent) {
      await session.send('Page.enable');
      await session.send('Page.addScriptToEvaluateOnNewDocument', { source });
    }
    await evaluate(session, source);
  } catch (err) {
    session.close();
    throw err;
  }
  return session;
}

async function watch(port, { once = false } = {}) {
  const source = fs.readFileSync(USER_SCRIPT, 'utf8');
  const sessions = new Map(); // target id -> CdpSession (null while attaching)
  const failedAt = new Map();
  let misses = 0;
  for (;;) {
    let targets;
    try {
      targets = await getJSON(port, '/json/list');
      misses = 0;
    } catch (err) {
      if (once) throw err;
      if (++misses >= 5) break; // Claude has quit
      await sleep(1000);
      continue;
    }
    const pending = [];
    for (const t of targets) {
      if (!isInjectable(t) || sessions.has(t.id)) continue;
      if (Date.now() - (failedAt.get(t.id) || 0) < 10000) continue;
      sessions.set(t.id, null);
      pending.push(attach(t, source, { persistent: !once }).then(
        (s) => {
          log(`已注入 → ${t.title || t.url}`);
          if (once) {
            sessions.delete(t.id);
            return reportStatus(s, t).finally(() => s.close());
          }
          sessions.set(t.id, s);
          s.onclose = () => sessions.delete(t.id);
          setTimeout(() => reportStatus(s, t), 4000);
          return undefined;
        },
        (err) => {
          sessions.delete(t.id);
          failedAt.set(t.id, Date.now());
          log(`注入失败 ${t.url}: ${err.message}`);
        },
      ));
    }
    if (once) {
      await Promise.all(pending);
      return;
    }
    await sleep(1000);
  }
  for (const s of sessions.values()) s?.close();
  log('Claude 已退出，注入器结束。');
}

// ------------------------------------------------------------------ Claude process

function findApp(explicit) {
  const env = process.env;
  let candidates;
  if (explicit) candidates = [explicit];
  else if (process.platform === 'darwin') {
    candidates = ['/Applications/Claude.app', path.join(os.homedir(), 'Applications', 'Claude.app')];
  } else if (process.platform === 'win32') {
    candidates = [
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'AnthropicClaude', 'claude.exe'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Claude', 'Claude.exe'),
      env.ProgramFiles && path.join(env.ProgramFiles, 'Claude', 'Claude.exe'),
    ];
  } else {
    const which = spawnSync('which', ['claude-desktop'], { encoding: 'utf8' });
    candidates = [which.stdout.trim(), '/usr/bin/claude-desktop'];
  }
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function macAppName(app) {
  return path.basename(app).replace(/\.app$/, '');
}

// Matching on the full path would also match this script when it was given --app, so exclude ourselves.
function linuxPids(app) {
  const r = spawnSync('pgrep', ['-f', app], { encoding: 'utf8' });
  return r.stdout.split('\n').map(Number).filter((pid) => pid && pid !== process.pid);
}

function isClaudeRunning(app) {
  if (process.platform === 'darwin') {
    return spawnSync('pgrep', ['-x', macAppName(app)]).status === 0;
  }
  if (process.platform === 'win32') {
    const dir = path.dirname(app).replace(/'/g, "''");
    const ps = `@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${dir}\\*' }).Count`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
    return Number(r.stdout.trim()) > 0;
  }
  return linuxPids(app).length > 0;
}

async function quitClaude(app) {
  if (process.platform === 'darwin') {
    spawnSync('osascript', ['-e', `tell application "${macAppName(app)}" to quit`]);
  } else if (process.platform === 'win32') {
    throw new Error('Claude 正在运行。请在任务栏右下角的托盘图标里选择 Quit 完全退出 Claude，然后再运行一次。');
  } else {
    for (const pid of linuxPids(app)) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already exited
      }
    }
  }
  for (let i = 0; i < 40; i++) {
    if (!isClaudeRunning(app)) return;
    await sleep(500);
  }
  throw new Error('Claude 没有退出（可能在等你确认）。请手动完全退出 Claude 后再试。');
}

function launchClaude(app, port) {
  const flag = `--remote-debugging-port=${port}`;
  if (process.platform === 'darwin') {
    const r = spawnSync('open', ['-a', app, '--args', flag], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`无法启动 ${app}: ${r.stderr.trim()}`);
    return;
  }
  spawn(app, [flag], { detached: true, stdio: 'ignore' }).unref();
}

function activateClaude(app) {
  if (process.platform === 'darwin') spawnSync('open', ['-a', app]);
}

// ------------------------------------------------------------------ background injector

function injectorPid() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8'));
    process.kill(pid, 0);
    return pid;
  } catch (err) {
    return err.code === 'EPERM' ? -1 : 0;
  }
}

function claimPidFile() {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
  const release = () => {
    try {
      if (fs.readFileSync(PID_FILE, 'utf8') === String(process.pid)) fs.unlinkSync(PID_FILE);
    } catch {
      // already gone
    }
  };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
}

function spawnInjector(port) {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  try {
    if (fs.statSync(LOG_FILE).size > 1024 * 1024) fs.truncateSync(LOG_FILE, 0);
  } catch {
    // no log yet
  }
  const out = fs.openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [SELF, 'inject', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(out);
}

async function runInjector(opts) {
  if (!opts.once) {
    if (injectorPid()) {
      log('注入器已经在后台运行了。');
      return;
    }
    claimPidFile();
  }
  await watch(opts.port, { once: opts.once });
}

// ------------------------------------------------------------------ commands

async function cmdStart(opts) {
  let app = null;
  if (!(await isPortOpen(opts.port))) {
    app = findApp(opts.app);
    if (!app) {
      throw new Error('没有找到 Claude 桌面版。请用 --app 指定它的位置，例如 --app "/Applications/Claude.app"');
    }
    if (isClaudeRunning(app)) {
      if (!opts.restart) {
        throw new Error('Claude 已经以普通方式在运行，无法接入。请先完全退出 Claude（⌘Q），或者加上 --restart 让我帮你重启它。');
      }
      log('正在退出 Claude……');
      await quitClaude(app);
    }
    log(`正在以导航模式启动 Claude（端口 ${opts.port}）……`);
    launchClaude(app, opts.port);
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await isPortOpen(opts.port);
    }
    if (!ready) {
      throw new Error(`等了 30 秒，Claude 仍没有打开调试端口 ${opts.port}。如果 Claude 其实已经在运行，请完全退出后再试。`);
    }
  } else {
    app = findApp(opts.app);
    if (app) activateClaude(app);
  }
  if (opts.detach) {
    if (!injectorPid()) spawnInjector(opts.port);
    log(`导航条已启用，注入器在后台运行（日志: ${LOG_FILE}）。`);
    return;
  }
  log('导航条已启用。保持这个终端打开；Claude 退出后这里会自动结束。');
  await runInjector(opts);
}

async function cmdStatus(opts) {
  let targets;
  try {
    targets = await getJSON(opts.port, '/json/list');
  } catch {
    throw new Error(`端口 ${opts.port} 上没有以导航模式运行的 Claude。`);
  }
  const pid = injectorPid();
  console.log(`后台注入器: ${pid ? `运行中${pid > 0 ? ` (pid ${pid})` : ''}` : '未运行'}`);
  for (const t of targets.filter(isInjectable)) {
    const s = await new CdpSession(t.webSocketDebuggerUrl).connect().catch(() => null);
    const st = s && (await evaluate(s, STATUS_EXPR).catch(() => null));
    s?.close();
    const desc = st ? `${st.count} 条提问，来源 ${st.source}${st.selector ? `，选择器 ${st.selector}` : ''}` : '未注入';
    console.log(`- [${t.type}] ${t.title || '(无标题)'}  ${t.url}\n    ${desc}`);
  }
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

function installFiles() {
  fs.mkdirSync(path.join(HOME_DIR, 'bin'), { recursive: true });
  fs.copyFileSync(USER_SCRIPT, path.join(HOME_DIR, 'prompt-nav.user.js'));
  fs.copyFileSync(SELF, path.join(HOME_DIR, 'bin', 'claude-nav.mjs'));
  return path.join(HOME_DIR, 'bin', 'claude-nav.mjs');
}

function createMacLauncher(script, port) {
  const contents = path.join(MAC_LAUNCHER, 'Contents');
  fs.rmSync(MAC_LAUNCHER, { recursive: true, force: true });
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });

  let icon = '';
  const claudeApp = findApp(null);
  if (claudeApp) {
    const r = spawnSync('plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', path.join(claudeApp, 'Contents', 'Info.plist')], { encoding: 'utf8' });
    const name = r.status === 0 ? r.stdout.trim() : '';
    const file = name && path.join(claudeApp, 'Contents', 'Resources', name.endsWith('.icns') ? name : `${name}.icns`);
    if (file && fs.existsSync(file)) {
      fs.copyFileSync(file, path.join(contents, 'Resources', 'AppIcon.icns'));
      icon = '<key>CFBundleIconFile</key><string>AppIcon</string>';
    }
  }

  fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Claude Prompt Nav</string>
  <key>CFBundleDisplayName</key><string>Claude Prompt Nav</string>
  <key>CFBundleIdentifier</key><string>io.github.qkwom.claude-prompt-nav</string>
  <key>CFBundleVersion</key><string>0.2.0</string>
  <key>CFBundleShortVersionString</key><string>0.2.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>LSUIElement</key><true/>
  ${icon}
</dict>
</plist>
`);

  const launcher = path.join(contents, 'MacOS', 'launch');
  fs.writeFileSync(launcher, `#!/bin/bash
# Opens Claude with the prompt navigator. Generated by claude-nav.mjs install.
if ! OUT=$(${shellQuote(process.execPath)} ${shellQuote(script)} start --restart --detach --port ${port} 2>&1); then
  /usr/bin/osascript - "$OUT" <<'APPLESCRIPT'
on run argv
  display alert "Claude Prompt Nav" message (item 1 of argv) as critical
end run
APPLESCRIPT
fi
`);
  fs.chmodSync(launcher, 0o755);
}

function windowsDesktop() {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8' });
  const dir = r.status === 0 ? r.stdout.trim() : '';
  return dir && fs.existsSync(dir) ? dir : path.join(os.homedir(), 'Desktop');
}

function cmdInstall(opts) {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 22) throw new Error(`需要 Node.js 22 或更新版本（当前 ${process.version}）。`);
  const script = installFiles();
  console.log(`已安装到 ${HOME_DIR}`);
  if (process.platform === 'darwin') {
    createMacLauncher(script, opts.port);
    console.log(`已创建启动器: ${MAC_LAUNCHER}`);
    console.log('以后用它来打开 Claude（可以拖到 Dock 上替换原来的 Claude 图标）。');
    console.log('如果 Claude 已经以普通方式打开，启动器会先让它退出，再以导航模式重新打开。');
  } else if (process.platform === 'win32') {
    const cmd = path.join(windowsDesktop(), 'Claude Prompt Nav.cmd');
    fs.writeFileSync(cmd, `@echo off\r\n"${process.execPath}" "${script}" start --detach --port ${opts.port}\r\nif errorlevel 1 pause\r\n`);
    console.log(`已在桌面创建启动器: ${cmd}`);
    console.log('以后先从托盘完全退出 Claude，再双击它打开 Claude。');
  } else {
    console.log(`以后用这条命令打开 Claude:\n  ${shellQuote(process.execPath)} ${shellQuote(script)} start --restart --detach`);
  }
}

function cmdUninstall() {
  fs.rmSync(HOME_DIR, { recursive: true, force: true });
  if (process.platform === 'darwin') fs.rmSync(MAC_LAUNCHER, { recursive: true, force: true });
  if (process.platform === 'win32') fs.rmSync(path.join(windowsDesktop(), 'Claude Prompt Nav.cmd'), { force: true });
  console.log('已删除 Claude Prompt Nav 的启动器和安装文件。');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (['start', 'inject', 'status'].includes(opts.cmd) && typeof WebSocket === 'undefined') {
    throw new Error(`需要 Node.js 22 或更新版本（当前 ${process.version}）。`);
  }
  switch (opts.cmd) {
    case 'start': return cmdStart(opts);
    case 'inject':
      if (!(await isPortOpen(opts.port))) throw new Error(`端口 ${opts.port} 上没有以导航模式运行的 Claude。`);
      return runInjector(opts);
    case 'status': return cmdStatus(opts);
    case 'install': return cmdInstall(opts);
    case 'uninstall': return cmdUninstall();
    case 'help': console.log(USAGE); return undefined;
    default: throw new UsageError(`未知命令: ${opts.cmd}`);
  }
}

main().catch((err) => {
  console.error(err instanceof UsageError ? `${err.message}\n\n${USAGE}` : err.message);
  process.exit(1);
});
