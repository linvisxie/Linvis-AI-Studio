# Linvis AI Studio — 统一工程规则

本文件是本仓库对**所有** AI Agent 平台的唯一权威工程约定。
Cindy / Pi、Codex、DSH 以及纯命令行运行时都必须遵守同一套规则与同一套命令。

---

## 0. 一句话架构

```
配置 (projects/<id>/project.json)
        │
        ▼
   linvis CLI  ← 唯一入口，平台无关
        │
        ├── engine/lib/remotion.mjs  → Remotion (React) → 帧序列 + 音频
        ├── engine/lib/ffmpeg.mjs    → FFmpeg 合成 / 探测 / 质检
        └── engine/lib/audio.mjs     → 程序化生成 BGM/SFX（零版权成本）
        │
        ▼
      out/render/*.mp4
```

**核心约束：视频引擎不感知、不依赖任何 Agent 平台。**
Agent 平台（Cindy/Codex/DSH）只是「调用方」，通过 shell 执行同一个 `linvis` 命令。

---

## 1. 铁律

1. **不得**为了让引擎跑起来而修改任何 Agent 平台源码（Cindy、Codex、DSH、app.asar、GameEngine、插件）。
2. **不得**调用任何付费 API（视频/图片/音频/TTS/云渲染）。预算为零。
3. **不得**把 Codex 订阅额度当作运行前提。渲染不需要任何 LLM。
4. **不得**在 `project.json` 之外隐藏状态。相同配置 + 相同资产 ⇒ 必须复现同一视频。
5. **不得**覆盖 `projects/` 下已存在的工作成果。初始化用 `init`，它拒绝覆盖已有工程。
6. 依赖只装在**项目级** `node_modules` / `.venv`，不装全局。
7. 任何"占位"产物（如 SAPI 合成配音）必须显式标记 `placeholder: true`，且不得伪装成最终交付。

---

## 2. 目录职责

| 路径 | 职责 | 谁可以改 |
|---|---|---|
| `engine/` | 平台无关 CLI 与渲染引擎 | 开发者 |
| `engine/adapters/jianying/` | 剪映草稿适配器（project.json → 剪映原生草稿） | 开发者 |
| `video/` | Remotion 渲染源工程（React 组件 = 镜头模板） | 开发者 |
| `projects/<id>/project.json` | 单个视频的**唯一**配置源 | Agent / 用户 |
| `projects/<id>/assets/` | 该工程私有素材（图片、配音、字幕、生成音频） | Agent / 用户 |
| `assets/recipes/` | 可复用的音频生成配方（JSON） | 开发者 |
| `out/` | 渲染产物与日志，可安全删除 | 自动生成 |
| `docs/` | 使用说明与测试报告 | 开发者 |
| `.agents/skills/linvis-video/` | Agent Skill 入口（跨平台标准路径，项目级源文件） | 开发者 |
| `tools/register-skill.mjs` | 把 Skill 注册到用户级目录（Junction，不复制） | 开发者 |

---

## 3. 唯一命令接口

所有平台统一使用以下命令（等价写法：`npm run linvis -- <cmd>`）：

```bash
node engine/bin/linvis.mjs doctor                        # 环境自检
node engine/bin/linvis.mjs init <ProjectName>            # 新建工程（拒绝覆盖）
node engine/bin/linvis.mjs audio <project>               # 程序化生成 BGM/SFX
node engine/bin/linvis.mjs captions <project> --audio <wav>  # 转写生成字幕
node engine/bin/linvis.mjs preview <project>             # 低成本预览（1/2 分辨率）
node engine/bin/linvis.mjs render <project>              # 完整渲染 1080x1920
node engine/bin/linvis.mjs scenes <project>              # 逐镜头分段渲染（供剪映逐轨编辑）
node engine/bin/linvis.mjs still <project> --frame 60    # 单帧导出（调试）
node engine/bin/linvis.mjs inspect <project>             # 输出质量质检
node engine/bin/linvis.mjs jianying <project> --name <n> # 生成剪映原生可编辑草稿
node engine/bin/linvis.mjs jianying inspect <n>          # 检查剪映草稿完整性
node engine/bin/linvis.mjs duck <project> --compare      # 配音侧链压缩 BGM
```

通用参数：`--project <path>`、`--json`（机器可读输出）、`--force`（覆盖输出）。

**返回值约定**：`0` 成功，`1` 运行失败，`2` 参数/配置错误。失败时必须写出
`out/logs/<ts>-<cmd>.log` 并在 stdout 打印末 20 行错误摘要。

---

## 4. 工程配置契约

`projects/<id>/project.json` 必须符合 `engine/schema/project.schema.json`。
关键字段（详见 schema）：

- `video`: `width`(1080) / `height`(1920) / `fps`(30) / `durationInFrames` / `backgroundColor`
- `scenes[]`: 每个镜头有 `id`、`type`、`from`、`durationInFrames` 与类型专属 props
- `audio.layers[]`: `{ id, src, from, volume, fadeInFrames, fadeOutFrames }`
  - 可选 `role`: `"voice"` / `"music"`，`duck` 命令靠它识别配音与 BGM
- `captions`: `{ enabled, src, style }`

**修改一个镜头 = 只改 `scenes[]` 里对应那一项的 props，然后重跑 `render`。**

镜头类型（V1.0）：

| type | 用途 |
|---|---|
| `cold-open` | 冷开场 HUD / 扫描线 / 收紧张力 |
| `impact-title` | 电影级撞击标题（缩放砸入 + 色散 + 抖动 + 冲击波） |
| `dissolve` | 快切短句收束成一句（预告片式信息轰炸） |
| `reveal-question` | 反问揭示（缓慢浮现 + 细线扩张） |
| `text-lines` | 文字逐行/逐字动画 |
| `image-scene` | 图片镜头（Ken Burns 缓动 + 转场） |
| `shape-motion` | 图形与几何动画 |
| `voice-caption` | 配音驱动的词级高亮字幕段落 |
| `blank` | 纯黑留白（音乐硬停 / 呼吸） |

所有文字组件内置**自动适配排版**：字号过大时自动折行并缩小，永不溢出画布。
这意味着改文案不需要手动调字号。

---

## 5. 素材与许可

- **禁止**引入许可不明素材。所有音乐/音效默认由 `linvis audio` 程序化生成，属本工程原创，
  CC0 等效（无第三方权利）。生成配方在 `assets/recipes/`，可审计、可复现。
- 外部素材（音乐、图片、配音）放入 `projects/<id>/assets/`，并在 `project.json` 的
  `licenses[]` 里登记来源与许可。
- 占位配音使用 Windows SAPI，必须带 `placeholder: true` 与 `"PLACEHOLDER"` 音频文件名标记。

---

## 6. 验收口径

一个改动算"完成"，必须同时满足：

1. `linvis doctor` 全绿（允许显式标注的可选缺失项）。
2. `linvis render` 成功退出码 0。
3. `linvis inspect` 报告分辨率/帧率/时长/音轨/亮度全部通过。
4. 相同配置重跑两次，`ffprobe` 关键参数一致。
5. 全程不启动任何 Agent 平台也能完成（可直接在 `cmd` 里跑）。

---

## 7. 平台适配状态（诚实标记）

| 平台 | 状态 | 依据 |
|---|---|---|
| Cindy + Pi Harness | **已实测** | `node tools/verify-pi-skill.mjs` 解析 Pi 真实启动注入的 system prompt，确认 `linvis-video` Skill 与 `AGENTS.md` 全文均被注入 |
| Cindy 设置页可见性 | **已实测** | 已在 `~/.agents/skills/` 与 `~/.claude/skills/` 建 Junction 指向项目内唯一源文件；在非项目目录下 Pi 仍能发现该 Skill |
| 独立命令行 | **已实测** | `scripts/render-standalone.cmd` 清除所有 Agent 环境变量后完整跑通 doctor→audio→render→inspect |
| 剪映原生草稿（11.7.0.14652） | **已实测** | 明文 `draft_content.json` + 本机骨架；剪映实际打开、显示 5 条轨道、接管加密保存。详见 `docs/V1.1-TEST-REPORT.md` |
| Codex | **待验证** | 已提供 `AGENTS.md` + `.codex/README.md`；Codex 遵循同一 `AGENTS.md` 约定，但未做真实 Codex 会话验证 |
| DSH | **待验证** | 已提供 `.dsh/skills/linvis-video.md` 指针；未在 DSH 0.2.1-rc.5 中做真实 Skill 加载验证 |

未验证的能力一律标 `待验证`，不得宣称完成。

### 已完成的硬指标验证

| 指标 | 结果 |
|---|---|
| 1080×1920 / 30fps / 9:16 | ✅ `inspect` 通过 |
| H.264 yuv420p bt709 tv-range | ✅ `ffprobe` 确认 |
| 响度 -14 LUFS（EBU R128） | ✅ 实测 -14.77 LUFS / -1.12 dBTP |
| 音画同步（撞击点 + 音乐硬停） | ✅ `silencedetect` 硬停 3.62–4.30s，与设计 3.60–4.30s 一致 |
| 帧级可复现 | ✅ 同一帧两次渲染 sha256 一致 |
| 音频字节级可复现 | ✅ 同一配方两次生成 sha256 一致 |
| 改一个镜头后重渲染 | ✅ 只改 `props.text` 即生效 |
| `init` 拒绝覆盖 | ✅ 退出码 2 |
| 配置错误拒绝渲染 | ✅ 镜头重叠返回退出码 2 |
