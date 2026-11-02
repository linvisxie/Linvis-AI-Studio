#!/usr/bin/env node
/**
 * 把项目的 linvis-video Skill 注册到「用户级」Skill 目录，
 * 让 Cindy 设置页能看见它。
 *
 * 为什么需要这一步：
 *   项目级 .agents/skills/ 只在「以该项目为工作目录」的会话里被发现，
 *   并且需要项目信任。Cindy 的「设置 → Skills」列表只扫描用户级目录，
 *   所以项目级 Skill 不会出现在设置页里。
 *
 * 做法：在用户级目录建 Windows Junction（目录链接），指向项目内的唯一源文件。
 *   不复制文件 → 永远不会出现两份不一致的核心指令。
 *
 * 用法:
 *   node tools/register-skill.mjs            # 注册
 *   node tools/register-skill.mjs --uninstall # 移除链接（不删源文件）
 *   node tools/register-skill.mjs --status    # 只看状态
 */
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_NAME = 'linvis-video';
const SOURCE = path.join(ROOT, '.agents', 'skills', SKILL_NAME);

const HOME = process.env.USERPROFILE ?? process.env.HOME;
const TARGETS = [
  path.join(HOME, '.agents', 'skills', SKILL_NAME),
  path.join(HOME, '.claude', 'skills', SKILL_NAME),
];

const args = process.argv.slice(2);
const isWindows = process.platform === 'win32';

function runPs(cmd) {
  return execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
}

function linkInfo(p) {
  if (!fs.existsSync(p)) return { exists: false };
  const st = fs.lstatSync(p);
  if (st.isSymbolicLink()) return { exists: true, type: 'symlink' };
  if (isWindows) {
    try {
      const out = runPs(`(Get-Item -LiteralPath '${p.replace(/'/g, "''")}').LinkType`);
      if (out === 'Junction') return { exists: true, type: 'junction' };
    } catch { /* ignore */ }
  }
  return { exists: true, type: 'directory' };
}

/* ---------- status ---------- */
if (args.includes('--status')) {
  console.log(`源: ${SOURCE}`);
  console.log(`  存在: ${fs.existsSync(path.join(SOURCE, 'SKILL.md')) ? '是' : '否'}\n`);
  for (const t of TARGETS) {
    const i = linkInfo(t);
    const ok = i.exists && (i.type === 'junction' || i.type === 'symlink');
    console.log(`${ok ? '✅' : i.exists ? '⚠️ ' : '❌'} ${t}`);
    console.log(`   ${i.exists ? `类型: ${i.type}` : '不存在'}`);
  }
  process.exit(0);
}

/* ---------- uninstall ---------- */
if (args.includes('--uninstall')) {
  for (const t of TARGETS) {
    const i = linkInfo(t);
    if (!i.exists) { console.log(`跳过（不存在）: ${t}`); continue; }
    if (i.type === 'junction' || i.type === 'symlink') {
      fs.rmSync(t, { recursive: false, force: true });
      console.log(`已移除链接: ${t}`);
    } else {
      console.log(`⚠️  ${t} 是实体目录，不是我们建的链接，已跳过以免误删`);
    }
  }
  console.log('\n源文件未改动:', SOURCE);
  process.exit(0);
}

/* ---------- install ---------- */
if (!fs.existsSync(path.join(SOURCE, 'SKILL.md'))) {
  console.error(`❌ 源 Skill 缺失: ${path.join(SOURCE, 'SKILL.md')}`);
  process.exit(1);
}

console.log(`源: ${SOURCE}\n`);

for (const t of TARGETS) {
  const i = linkInfo(t);

  if (i.exists) {
    if (i.type === 'junction' || i.type === 'symlink') {
      console.log(`✅ 已存在链接: ${t}`);
      continue;
    }
    console.error(`❌ ${t} 已存在且是实体目录（不是链接）`);
    console.error('   为避免误删，已跳过。请先手动确认并移除该目录。');
    continue;
  }

  fs.mkdirSync(path.dirname(t), { recursive: true });

  try {
    if (isWindows) {
      runPs(`New-Item -ItemType Junction -Path '${t.replace(/'/g, "''")}' -Target '${SOURCE.replace(/'/g, "''")}' | Out-Null`);
    } else {
      fs.symlinkSync(SOURCE, t, 'dir');
    }
    console.log(`✅ 已创建链接: ${t}`);
  } catch (e) {
    console.error(`❌ 创建失败 ${t}: ${e.message}`);
    if (isWindows) {
      console.error('   Windows 建 Junction 不需要管理员权限；若仍失败，尝试以普通用户重新运行。');
    }
  }
}

console.log('\n完成。请重启 Cindy（或重新打开设置页）以刷新 Skill 列表。');
console.log('验证: node tools/verify-pi-skill.mjs');
