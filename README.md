# Linvis AI Studio

平台无关的本地 AI 视频制作引擎。竖屏 1080×1920 / 30FPS / 电影级开场。
Cindy、Codex、DSH 或纯命令行驱动同一套工程。

## 30 秒上手

```bash
cd D:/Linvis-AI-Studio
node engine/bin/linvis.mjs doctor                    # 环境自检
node engine/bin/linvis.mjs render EP01-LLM-Harness   # 渲染样片
node engine/bin/linvis.mjs inspect EP01-LLM-Harness  # 质检
```

产物：`out/render/EP01-LLM-Harness-final.mp4`

## 核心设计

```
projects/<id>/project.json     ← 唯一配置源（改这里就够）
         │
         ▼
  engine/bin/linvis.mjs        ← 唯一命令入口，平台无关
         │
    ┌────┴────┬──────────┐
    ▼         ▼          ▼
 Remotion   FFmpeg   程序化音频合成
 （画面）   （合成/质检） （零版权 BGM/SFX）
         │
         ▼
   out/render/*.mp4
```

引擎不 import 任何 Agent SDK，不读 Agent 会话状态。Agent 平台只是"调用方"。

## 文档

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | **所有 Agent 平台的统一工程规则**（唯一权威） |
| [docs/USAGE.md](docs/USAGE.md) | 完整使用说明：命令、镜头类型、音频配方、字幕 |
| [docs/TEST-REPORT.md](docs/TEST-REPORT.md) | V1.0 测试报告：实测证据与已知限制 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 后续开发路线 |

## 平台接入

| 平台 | 入口 | 状态 |
|---|---|---|
| Cindy / Pi | `.agents/skills/linvis-video/SKILL.md`，`node tools/verify-pi-skill.mjs` 验证 | **已实测** |
| 独立命令行 | `scripts/render-standalone.cmd` / `.sh` | **已实测** |
| Codex | `.codex/README.md`，读 `AGENTS.md` | **待验证** |
| DSH | `.dsh/skills/linvis-video.md` | **待验证** |

## 铁律

1. 不修改任何 Agent 平台源码
2. 不调用任何付费 API（预算为零）
3. 不把 Codex 订阅额度当运行前提
4. 配置之外无隐藏状态，相同配置必须复现同一视频
5. 不覆盖既有工程
6. 占位产物必须显式标记

完整规则见 [AGENTS.md](AGENTS.md)。

## 回滚

对系统零侵入：依赖只在项目 `node_modules/` 与 `.venv/`，未改任何 Agent 配置。
删除 `out/` 只丢渲染产物；删除 `.dsh/` `.codex/` 只去掉适配层。

## 许可

代码 MIT。所有生成的音乐/音效为本工程程序化合成，无第三方权利（CC0 等效）。
外部素材需在 `project.json` 的 `licenses[]` 登记。
