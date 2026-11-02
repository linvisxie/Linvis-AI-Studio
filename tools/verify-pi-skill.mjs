#!/usr/bin/env node
/**
 * 验证 Cindy/Pi 真实加载 linvis-video Skill 与 AGENTS.md 工程规则。
 *
 * 为什么这样做：仅检查 SKILL.md 文件存在是伪验证。Pi 是否真的把这个 Skill
 * 注入 system prompt，只有跑一次真实启动才知道。
 *
 * 为保证零成本、不联网、不消耗任何订阅额度，本脚本：
 *   1. 启动一个本地 OpenAI 兼容 SSE stub（tools/stub-openai-server.mjs）
 *   2. 用临时 agent 目录指向这个 stub 作为模型
 *   3. 真实启动 pi --approve --mode json，然后解析启动时注入的 system prompt
 *
 * 用法: node tools/verify-pi-skill.mjs
 *       node tools/verify-pi-skill.mjs "C:/path/to/pi/1.0.2"
 */
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cwd = process.cwd();
const piDir = process.argv[2]
  ?? path.join(process.env.APPDATA ?? '', 'CindyGlobal', 'pi', '1.0.2');
const piExe = path.join(piDir, process.platform === 'win32' ? 'pi.exe' : 'pi');
const PORT = 8811;
const AGENT_DIR = path.join(cwd, 'out', 'pi-verify-agent');

if (!fs.existsSync(piExe)) {
  console.error(`❌ 未找到 Pi 可执行文件: ${piExe}`);
  console.error('   传入安装目录: node tools/verify-pi-skill.mjs "C:/path/to/pi/1.0.2"');
  process.exit(2);
}

console.log(`Pi: ${piExe}`);
console.log(`工作目录: ${cwd}`);
console.log('模式: 本地 stub 模型（零成本、离线、不消耗任何额度）\n');

/* ---------- 准备临时 agent 目录 ---------- */
fs.mkdirSync(AGENT_DIR, { recursive: true });
fs.writeFileSync(path.join(AGENT_DIR, 'models.json'), JSON.stringify({
  providers: {
    'linvis-stub': {
      baseUrl: `http://127.0.0.1:${PORT}/v1`,
      api: 'openai-completions',
      apiKey: 'stub-key-not-a-real-secret',
      models: [{ id: 'linvis-stub', name: 'Linvis Stub (local, no cost)' }],
    },
  },
}, null, 2));

/* ---------- 启动 stub ---------- */
const stub = spawn(process.execPath, [path.join(cwd, 'tools', 'stub-openai-server.mjs'), String(PORT)], {
  stdio: 'ignore',
  detached: false,
});

const cleanup = () => { try { stub.kill(); } catch { /* ignore */ } };
process.on('exit', cleanup);

await new Promise((r) => setTimeout(r, 1200));

/* ---------- 真实启动 pi ---------- */
const args = [
  '--approve',
  '--model', 'linvis-stub/linvis-stub',
  '--mode', 'json',
  '-p', 'reply with exactly: OK',
];

const result = await new Promise((resolve) => {
  const child = spawn(piExe, args, {
    cwd,
    env: { ...process.env, PI_CODING_AGENT_DIR: AGENT_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 180000);
  child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
});

/* ---------- 解析注入的 system prompt ---------- */
const records = result.out.split('\n').filter(Boolean).map((l) => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

const end = records.find((r) => r.type === 'agent_end');
const sysMsg = end?.messages?.find((m) => m.role === 'system');

if (!sysMsg?.sections) {
  console.error('❌ 未能从启动记录中解析 system prompt');
  console.error('   pi exit code:', result.code);
  if (result.err) console.error('   stderr:', result.err.slice(0, 800));
  process.exit(1);
}

const { skills, project_context } = sysMsg.sections;

const checks = [
  ['System prompt 注入', !!skills && !!project_context],
  ['Skill linvis-video 被发现', skills?.includes('linvis-video')],
  ['Skill 路径正确', (sysMsg.sections.skills ?? '').includes('.agents\\skills\\linvis-video') || (sysMsg.sections.skills ?? '').includes('.agents/skills/linvis-video')],
  ['AGENTS.md 被注入', project_context?.includes('AGENTS.md')],
  ['工程铁律被注入', project_context?.includes('不得**调用任何付费 API')],
  ['镜头类型表被注入', project_context?.includes('impact-title')],
];

console.log('注入段落:');
for (const [k, v] of Object.entries(sysMsg.sections)) {
  console.log(`  ${k.padEnd(18)} ${String(v).length} chars`);
}
console.log('');

let allPass = true;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) allPass = false;
}

console.log('');
if (allPass) {
  console.log('结论: Cindy/Pi 真实发现了 linvis-video Skill 与 AGENTS.md 工程规则。');
  console.log('      验证过程未调用真实模型，未消耗任何额度。');
  process.exit(0);
} else {
  console.log('结论: 验证未通过。检查 .agents/skills/linvis-video/SKILL.md 与 AGENTS.md。');
  console.log('      若 Skill 未出现，通常是项目信任未授予（需要 --approve）。');
  process.exit(1);
}
