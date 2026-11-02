#!/usr/bin/env bash
# ============================================================
# Linvis AI Studio — 独立命令行渲染 (bash / WSL / Git Bash / macOS / Linux)
#
# 完全不依赖 Cindy / Codex / DSH。
# 引擎只读取 projects/<id>/project.json 与项目内素材。
#
# 用法: bash scripts/render-standalone.sh EP01-LLM-Harness
# ============================================================
set -euo pipefail

PROJECT_ID="${1:-EP01-LLM-Harness}"
cd "$(dirname "$0")/.."

# 清除所有 Agent 平台环境变量，证明引擎不依赖它们
unset CINDY_HOME CODEX_HOME DSH_HOME PI_HOME CLAUDECODE 2>/dev/null || true
unset ANTHROPIC_API_KEY OPENAI_API_KEY 2>/dev/null || true

echo "============================================================"
echo " Linvis standalone render: $PROJECT_ID"
echo " CWD: $(pwd)"
echo " Agent env vars cleared"
echo "============================================================"
echo

echo "[1/4] 环境自检"
node engine/bin/linvis.mjs doctor --json | node -e "
  let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    const r=JSON.parse(s);
    if(!r.ok){console.error('环境自检失败');process.exit(1);}
    console.log('  OK — 必需项全部通过');
  });"

echo "[2/4] 按配方重新生成音频"
node engine/bin/linvis.mjs audio "$PROJECT_ID" --force

echo "[3/4] 渲染视频"
node engine/bin/linvis.mjs render "$PROJECT_ID" --force

echo "[4/4] 质量检查"
node engine/bin/linvis.mjs inspect "$PROJECT_ID"

echo
echo "============================================================"
echo " 完成 — 全程未启动任何 Agent 平台"
echo " 输出: out/render/${PROJECT_ID}-final.mp4"
echo "============================================================"
