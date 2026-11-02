# Linvis AI Studio V1.0 — 测试报告

测试日期：2026-11-02
测试机器：Windows，16 核 CPU，RTX 4050 Laptop 6GB（torch 为 CPU 版）
项目路径：`D:\Linvis-AI-Studio`

---

## 一、环境审计结果

| 组件 | 本机版本 | 来源 | 状态 |
|---|---|---|---|
| Node.js | v24.21.0 | 系统 | ✅ |
| npm / pnpm | 11.19.0 / 12.5.1 | 系统 | ✅ |
| FFmpeg | 9.0.2 full build（含 libx264 / libass / loudnorm） | WinGet | ✅ |
| Python | 3.13.15 | 系统 | ✅ |
| openai-whisper | 20250625（`base.pt` 已缓存 145MB） | 系统 | ✅ 可离线 |
| torch | 2.14.1+cpu | 系统 | ✅ |
| faster-whisper | 1.2.1（ctranslate2 4.8.4） | 项目 `.venv` | ⚠️ 已安装但模型快照不完整 |
| Remotion | 4.0.540 | 项目 `node_modules` | ✅ 本次新装 |
| 浏览器 | Chrome（系统安装） | 系统 | ✅ 复用，未下载 |
| 中文字体 | Noto Sans SC VF | 系统复制到 `video/public/fonts` | ✅ |
| Cindy | 0.1.115 | 已装 | ✅ |
| Pi Harness | 1.0.2 | Cindy 内置 | ✅ |
| Codex CLI | 0.159.2 | Cindy 内置包 | ✅ 存在 |
| DSH | 0.2.1-rc.5（`D:\dsh`） | 已装 | ✅ 存在 |
| GPU | RTX 4050 Laptop 6GB | — | 未被 torch 使用（CPU 版） |

**结论：本机未新增任何全局依赖。** Remotion 装在项目 `node_modules`，Python 隔离在项目 `.venv`，
字体从系统复制到项目内，浏览器复用系统 Chrome。未下载任何模型或可执行文件。

### 未消耗的额度

- 未调用任何付费 API（视频/图片/音频/TTS/云渲染）
- 未使用 Codex 订阅额度
- Skill 验证用的是本地 stub 模型服务（`tools/stub-openai-server.mjs`），零成本离线

---

## 二、已验证的功能（附证据）

### 2.1 Cindy + Pi 接入 —— 已实测

**验证方法**（可重复执行）：

```bash
node tools/verify-pi-skill.mjs
```

该方法不是"检查文件是否存在"，而是：

1. 启动本地 OpenAI 兼容 SSE stub（零成本、离线）
2. 用临时 agent 目录把它注册成 Pi 模型
3. 真实执行 `pi --approve --mode json -p "..."` 
4. 解析 Pi 启动时**实际注入的 system prompt**

**实测结果**：

```
注入段落:
  preamble           169 chars
  tools              339 chars
  rules              839 chars
  docs              1307 chars
  project_context   3886 chars   ← AGENTS.md 全文
  skills            2060 chars   ← 含 linvis-video
  cwd                 32 chars

✅ Skill linvis-video 被发现
✅ Skill 路径正确 → D:\Linvis-AI-Studio\.agents\skills\linvis-video\SKILL.md
✅ AGENTS.md 被注入
✅ 工程铁律被注入
✅ 镜头类型表被注入
```

**关键发现**：项目级 `.agents/skills` 需要**项目信任**（`--approve`）才被 Pi 扫描。
未授予信任时 Skill 不会出现在 system prompt 中。这一点已写进 Skill 与文档。

### 2.2 独立命令行渲染 —— 已实测

`scripts/render-standalone.cmd` 显式清除 `CINDY_HOME` / `CODEX_HOME` / `DSH_HOME` /
`PI_HOME` / `CLAUDE_CODE` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 后完整跑通：

```
[1/4] Environment check          → OK
[2/4] Regenerate audio           → 9.50s / 48kHz / 2ch
[3/4] Render video               → 响度 -16.70 → -14.77 LUFS
                                   输出 1080x1920 @30fps, 9.51s, h264/aac, 2.17MB
[4/4] Quality inspection         → 通过 10/10
DONE - no Agent platform was launched.
```

这是架构验收的硬要求：**完全不启动任何 Agent 平台也能渲染**。

### 2.3 输出规格 —— 已实测

`node engine/bin/linvis.mjs inspect EP01-LLM-Harness`：**通过 10/10**

| 检查项 | 实测值 | 要求 |
|---|---|---|
| 分辨率 | 1080×1920 | 9:16 竖屏 ✅ |
| 帧率 | 30 fps | 30 fps ✅ |
| 时长 | 9.51s | 8–10s ✅ |
| 视频编码 | h264 / yuv420p / High | ✅ |
| 色彩 | bt709 / tv range | ✅ |
| 音频轨 | aac 48000Hz 2ch | ✅ |
| 响度 | **-14.77 LUFS**，峰值 -1.12 dBTP | -14 LUFS 社交标准 ✅ |
| 文件大小 | 2.17 MB | — |

**修复过程记录**（诚实说明）：
- 初版输出为 `yuvj420p`（full range，社交平台会二次压缩）→ 改用 PNG 中间帧 + `colorSpace: 'bt709'` 修复
- 初版响度 -19.87 LUFS 偏低 → 加 EBU R128 后期归一。loudnorm 单通道受峰值限制只能到 -17.37，
  改为「实测增益 + alimiter 限幅」后达到 -14.77 LUFS

### 2.4 音画同步 —— 已实测

设计：1.20s 撞击（与标题同帧），3.60–4.30s 音乐硬停。

`ffmpeg silencedetect` 实测静音段：**3.62s → 4.30s**

误差 0.02s（不到 1 帧）。硬停的实现方式是**该区间不放置任何发声层**，
而不是把音量设为 0——后者会残留底噪。

### 2.5 可复现性 —— 已实测

| 项目 | 方法 | 结果 |
|---|---|---|
| 音频字节级 | 同一配方生成两次，比较 sha256 | ✅ 完全一致 `b5cf8979...` |
| 视频帧级 | 同一帧号渲染两次，比较 sha256 | ✅ 完全一致 `3b0537dc...` |

所有动画都基于 `useCurrentFrame()` 的确定性数学，无 `Math.random()`、无 `Date.now()`。
程序化音频用 mulberry32 定种子 PRNG。

### 2.6 改一个镜头后重渲染 —— 已实测

只改 `project.json` 中 `s2-impact.props.text` 与 `fontSize`，不改任何代码：

```json
"text": "这一次，真的不一样。",
"fontSize": 132
```

重渲染后画面正确显示新文案，且**自动折行适配**（原字号会导致溢出，自动排版收缩并换行）。
验证后已恢复原配置。

### 2.7 配置校验与错误恢复 —— 已实测

| 场景 | 退出码 | 行为 |
|---|---|---|
| `init` 已存在的工程 | 2 | 拒绝覆盖并提示 |
| 镜头时间重叠 | 2 | 报出 `scenes[1] 与上一镜头时间重叠 (from=10 < 150)` |
| 未知命令 | 2 | 打印帮助 |
| 正常 `doctor` | 0 | 全绿 |
| 渲染失败 | 1 | 写 `out/logs/<ts>-<cmd>.log` 并打印末 20 行摘要 |

### 2.8 字幕链路 —— 已实测（含降级）

技术路径：配音 → whisper 转写（词级时间戳）→ Remotion 词级高亮。

- 英文测试：`"Artificial intelligence cannot live by itself."` → 准确转写，15 个词级时间戳
- 渲染验证：`TEST-Captions` 工程逐词高亮位置正确（`The`、`Artificial` 高亮）

**遇到的问题与处理**：
1. faster-whisper 模型从 HuggingFace 下载时 CDN 连接超时 → 改为引擎自动降级
2. 本机缓存的 `faster-whisper-small` 快照缺 `model.bin` → 自动回退到 openai-whisper
3. 最终链路：faster-whisper 失败 → 自动切 openai-whisper（用本地 `base.pt`，完全离线）→ 成功

**限制说明**：Windows SAPI 的中文合成音质过差，转写结果为乱码。
这是占位音频本身的问题，不是引擎问题。**未做真人中文配音验证。**

---

## 三、首期样片 EP01-LLM-Harness

### 3.1 镜头结构（285 帧 / 9.5s / 30fps）

| 帧区间 | 时间 | 镜头 | 内容 |
|---|---|---|---|
| 0–35 | 0.00–1.20s | `cold-open` | HUD 环 + 刻度 + 扫描线，张力收紧 |
| 36–107 | 1.20–3.60s | `impact-title` | **「AI 要取代人类了！」** 撞击砸入 + 色散 + 冲击波 |
| 108–128 | 3.60–4.30s | `blank` | 音乐硬停，纯黑真空 |
| 129–179 | 4.30–6.00s | `dissolve` | 写诗→编程→考试→陪你聊天→它什么都会 →「除了……活着。」 |
| 180–284 | 6.00–9.50s | `reveal-question` | **「但你有没有想过」** + 两行副文案 |

### 3.2 音轨结构

全部由 `assets/recipes/ep01-open.json` 程序化合成（16 个图层），无第三方版权采样：

- 0.00–1.20s：46Hz drone + 升压 sweep + 三下倒数心跳
- 1.20s：主撞击（132→31Hz 扫频，distortion 1.35）+ 0.035s 后二次金属撕裂
- 1.20–3.60s：138bpm 推进鼓点 + 数字噪点
- 3.60–4.30s：**无任何图层**（硬停）
- 4.30–6.00s：稀疏脉冲 + 低音回升 + 末次升压
- 6.00s：反问落地低沉撞击
- 6.00–9.50s：40Hz 环境共振 + 52bpm 缓慢心跳 + 结尾轻推留悬念

### 3.3 版权状态

`licenses[]` 已登记：音频为**原创程序化合成**（确定性数学），无第三方权利，CC0 等效。
未使用任何外部音乐/音效素材。

---

## 四、未完成 / 待验证

### 必须诚实标记的项

| 项 | 状态 | 说明 |
|---|---|---|
| Codex 真实会话适配 | **待验证** | 已提供 `AGENTS.md` + `.codex/README.md`，引擎本身平台无关；但未在真实 Codex 会话里跑过 |
| DSH Skill 加载 | **待验证** | 已提供 `.dsh/skills/linvis-video.md` 指针，未在 DSH 0.2.1-rc.5 实测 |
| 真人配音 + 中文字幕 | **未验证** | 只有英文占位音频验证过，中文 SAPI 音质过差无法测 |
| faster-whisper 加速 | **不可用** | 已装但模型快照缺 `model.bin`，需联网补全；当前用 openai-whisper 替代 |

### 已知限制

1. **无 GUI**：符合第一阶段约定，交互全部靠 CLI 与 `project.json`
2. **无逐帧缓动曲线编辑**：动画参数写在组件里，改曲线需要改 `video/scenes/*.tsx`
3. **转场种类有限**：目前只有 fade / wipe / zoom 与黑色过渡，无 morph / 液体等
4. **图片素材未验证**：`image-scene` 已实现但 EP01 样片未使用图片，未做真实图片渲染验证
5. **单机串行渲染**：9.5s 视频约 33s（约 3.5x 实时），长视频会线性变慢
6. **无音频波形可视化**、无多轨独立音量自动化曲线

---

## 五、架构验收对照

| 验收要求 | 结果 | 证据 |
|---|---|---|
| Cindy + Pi 可操作视频生产流程 | ✅ | `verify-pi-skill.mjs` 确认 Skill 与规则注入 |
| 不使用 Codex 完成渲染 | ✅ | 全程未启动 Codex |
| 同一项目能从命令行独立渲染 | ✅ | `render-standalone.cmd` 清空 Agent 环境变量后跑通 |
| 工程文件和视频资产可重复使用 | ✅ | `projects/<id>/` 自包含；`init` 可复制结构 |
| 相同配置稳定复现视频 | ✅ | 帧级与音频级 sha256 一致 |
| 修改一个镜头后再次渲染 | ✅ | 只改 `props.text` 生效 |
| 字幕、声音、分辨率、格式符合要求 | ✅ | 1080×1920/30fps/h264/aac/-14LUFS；字幕链路已验证（英文） |
| 输出完整日志与使用说明 | ✅ | `out/logs/` 每次运行一个日志；`docs/USAGE.md` |
| Codex / DSH 兼容性 | ⚠️ 待验证 | 未做真实验证前不宣称完成 |

---

## 六、复现本报告的完整命令

```bash
cd D:/Linvis-AI-Studio

# 1. 环境
node engine/bin/linvis.mjs doctor

# 2. 生成音频（确定性）
node engine/bin/linvis.mjs audio EP01-LLM-Harness --force

# 3. 渲染 + 响度归一
node engine/bin/linvis.mjs render EP01-LLM-Harness --force

# 4. 质检（应通过 10/10）
node engine/bin/linvis.mjs inspect EP01-LLM-Harness

# 5. Cindy/Pi 接入验证（零成本）
node tools/verify-pi-skill.mjs

# 6. 脱离 Agent 的独立渲染
scripts\render-standalone.cmd EP01-LLM-Harness
```
