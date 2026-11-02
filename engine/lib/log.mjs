import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PATHS, ensureDirs } from './project.mjs';

let currentLog = null;

/** Start a per-run log file. Returns its path. */
export function startLog(cmd, argv = []) {
  ensureDirs();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(PATHS.logs, `${ts}-${cmd}.log`);
  currentLog = file;
  logLine(`# linvis ${cmd} ${argv.join(' ')}`);
  logLine(`# started ${new Date().toISOString()}`);
  logLine(`# node ${process.version} ${process.platform} ${process.arch}`);
  return file;
}

export function logPath() {
  return currentLog;
}

export function logLine(text) {
  const line = `[${new Date().toISOString()}] ${text}`;
  if (currentLog) {
    try { fs.appendFileSync(currentLog, line + '\n'); } catch { /* ignore */ }
  }
  return line;
}

export function info(text) {
  logLine(`INFO  ${text}`);
  console.log(text);
}

export function warn(text) {
  logLine(`WARN  ${text}`);
  console.log(`⚠️  ${text}`);
}

export function step(text) {
  logLine(`STEP  ${text}`);
  console.log(`\n▶ ${text}`);
}

export function fail(text) {
  logLine(`ERROR ${text}`);
  console.error(`❌ ${text}`);
}

/** Run a subprocess, stream output to console and log. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    logLine(`EXEC  ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? PATHS.root,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env, ...(opts.env || {}) },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      if (opts.echo !== false) process.stdout.write(s);
      logLine(`OUT   ${s.replace(/\n$/, '')}`);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (opts.echo !== false) process.stderr.write(s);
      logLine(`ERR   ${s.replace(/\n$/, '')}`);
    });
    child.on('error', (e) => {
      logLine(`SPAWN_FAIL ${e.message}`);
      resolve({ code: -1, stdout, stderr: stderr + '\n' + e.message, ms: Date.now() - started });
    });
    child.on('close', (code) => {
      logLine(`EXIT  ${code} (${Date.now() - started}ms)`);
      resolve({ code: code ?? -1, stdout, stderr, ms: Date.now() - started });
    });
  });
}

/** Print the tail of the current log as an error summary. */
export function printFailureSummary(lines = 20) {
  if (!currentLog || !fs.existsSync(currentLog)) return;
  const all = fs.readFileSync(currentLog, 'utf8').trimEnd().split('\n');
  console.error(`\n—— 日志末尾 ${Math.min(lines, all.length)} 行 ——`);
  console.error(all.slice(-lines).join('\n'));
  console.error(`—— 完整日志: ${currentLog} ——\n`);
}