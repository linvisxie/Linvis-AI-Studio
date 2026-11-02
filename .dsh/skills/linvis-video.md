# Linvis 视频引擎（DSH 适配入口）

本文件是 Linvis AI Studio 在 DeepSeek Harness 中的 Skill 入口。

**权威指令在 `.agents/skills/linvis-video/SKILL.md`。** 请先读它，不要在本文件重复维护规则。

## 为什么这里只有一个指针

DSH 的 Skill 加载路径与 Pi 不同。为避免同一套核心指令维护两份、进而 drifting，
这里只保留一份极简指针 + DSH 特有的执行注意事项。

## DSH 执行注意事项

1. **工作目录**：所有命令必须在 `D:/Linvis-AI-Studio` 下执行。
   DSH 的内置运行时自带的 Node 版本可能不同，优先使用系统 `node`（v24+）。

2. **命令形式**：DSH 通过 shell 执行，与 Cindy/Codex 完全相同：
   ```
   node engine/bin/linvis.mjs doctor
   node engine/bin/linvis.mjs render EP01-LLM-Harness
   ```

3. **Python 环境**：字幕转写需要 `faster-whisper` 或 `openai-whisper`。
   优先使用项目级 `.venv\Scripts\python.exe`，不要用 DSH 内置 python。

4. **不要修改**：本文件不改任何 DSH 内核、app.asar、GameEngine 或已有插件。
   本适配为纯新增文件，删除 `.dsh/` 即可完全回滚。

## 状态

**待验证**：本适配文件已写好，但尚未在 DSH 0.2.1-rc.5 中做真实 Skill 加载验证。
在完成真实验证前，不得宣称 DSH 适配已完成。
