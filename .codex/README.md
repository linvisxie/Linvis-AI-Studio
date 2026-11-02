# Codex 适配说明

**状态：待验证**

本文件说明如何在 Codex 中打开 `D:\Linvis-AI-Studio` 并操作同一套视频工程。

## 1. 已经具备的兼容基础

Codex 打开本目录时会自动读取根目录的 `AGENTS.md`，其中包含：
- 架构与铁律（不装付费 API、不改 Agent 源码、不覆盖既有工程）
- 完整命令清单
- `project.json` 配置契约与镜头类型表
- 素材许可要求与验收口径

这一点与 Cindy/Pi 完全一致——**同一份 `AGENTS.md`，不是两份规则**。

## 2. Codex 侧执行方式

Codex 通过 shell 执行同样的命令，无需任何额外配置：

```bash
cd D:/Linvis-AI-Studio
node engine/bin/linvis.mjs doctor
node engine/bin/linvis.mjs render EP01-LLM-Harness
```

引擎不 import 任何 Agent SDK，也不读取 Agent 会话状态，因此对 Codex 天然可用。

## 3. 已验证 / 未验证

| 项目 | 状态 | 依据 |
|---|---|---|
| 引擎脱离 Agent 独立运行 | **已实测** | 清除 `CODEX_HOME`/`CINDY_HOME`/`DSH_HOME` 等环境变量后渲染成功 |
| `AGENTS.md` 被 Pi 读取 | **已实测** | Pi 启动记录中 `project_context` 含 AGENTS.md 全文 |
| `AGENTS.md` 被 Codex 读取 | **待验证** | Codex 遵循相同的 AGENTS.md 约定，但本次未做真实 Codex 会话验证 |
| Codex 中 Skill 自动发现 | **待验证** | Codex 的 Skill 目录约定为 `~/.codex/skills/`，项目级 `.agents/skills/` 是否被扫描需实测 |

## 4. 建议的下一步验证（不消耗付费额度）

1. 在 Codex 中打开本目录，确认它读到了 `AGENTS.md`（可以直接问它铁律第 2 条是什么）。
2. 让 Codex 执行 `node engine/bin/linvis.mjs doctor`，确认退出码 0。
3. 让 Codex 修改 `projects/EP01-LLM-Harness/project.json` 中某个镜头的 `props.text`，
   然后执行 `render`，确认输出视频文字已变。
4. 完成以上三步后，才能把 Codex 适配标为「已实测」。

## 5. 注意

- 不要在 Codex 里使用 `codex exec` 包装渲染命令——直接调用 `node` 即可，避免多余一层。
- 如果 Codex 的工作目录不是 `D:/Linvis-AI-Studio`，先 `cd` 过去；引擎的相对路径依赖仓库根。
