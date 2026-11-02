# Linvis AI Studio — 使用说明

平台无关的本地 AI 视频制作引擎。竖屏 1080×1920 / 30FPS / 电影级开场。
Cindy、Codex、DSH 或纯命令行都能驱动同一套工程。

---

## 1. 快速开始

```bash
cd D:/Linvis-AI-Studio

# 1. 环境自检（必做）
node engine/bin/linvis.mjs doctor

# 2. 看看有哪些工程
node engine/bin/linvis.mjs list

# 3. 渲染 EP01 样片
node engine/bin/linvis.mjs render EP01-LLM-Harness

# 4. 质检
node engine/bin/linvis.mjs inspect EP01-LLM-Harness
```

产物在 `out/render/<project-id>-final.mp4`，日志在 `out/logs/`。

---

## 2. 命令清单

| 命令 | 作用 | 典型耗时 |
|---|---|---|
| `doctor` | 检查 Node / FFmpeg / Remotion / 浏览器 / 字体 / 转写引擎 | < 5s |
| `list` | 列出所有工程 | < 1s |
| `init <Name>` | 新建工程（拒绝覆盖已有） | < 1s |
| `audio <proj>` | 按配方程序化生成 BGM/SFX | < 1s |
| `captions <proj> --audio <f>` | 语音转字幕（词级时间戳） | 1–5 min |
| `preview <proj>` | 半分辨率快速预览 | ~15s |
| `render <proj>` | 完整渲染 + 响度归一 | ~40s |
| `still <proj> --frame N` | 导出单帧 PNG 调试 | ~8s |
| `inspect <proj>` | 质检：分辨率/帧率/时长/编码/亮度/响度 | ~10s |

通用参数：`--force`、`--json`、`--out <file>`、`--scale <n>`、`--crf <n>`、`--no-loudnorm`

退出码：`0` 成功 / `1` 运行失败 / `2` 参数或配置错误。

---

## 3. 改一个镜头

所有镜头内容都在 `projects/<id>/project.json` 的 `scenes[]` 里，**不需要动代码**。

```json
{
  "id": "s2-impact",
  "type": "impact-title",
  "from": 36,
  "durationInFrames": 72,
  "props": {
    "text": "AI 要取代人类了！",
    "hitFrame": 0,
    "fontSize": 168
  }
}
```

改完直接重跑：

```bash
node engine/bin/linvis.mjs render EP01-LLM-Harness
```

规则：
- `from` 与 `durationInFrames` 单位是**帧**（30fps ⇒ 30 帧 = 1 秒）
- 镜头之间不能重叠
- 所有镜头总长 ≤ `video.durationInFrames`
- 配置错误会返回退出码 2 并列出具体问题

### 可用镜头类型

| type | 视觉 | 关键 props |
|---|---|---|
| `cold-open` | HUD 环 + 扫描线 + 收紧张力 | `hud`, `whisper` |
| `impact-title` | 撞击砸入 + 色散 + 抖动 + 冲击波 | `text`, `kicker`, `tag`, `hitFrame`, `fontSize` |
| `dissolve` | 快切短句收束成一句 | `flashes[]`, `finalLine` |
| `reveal-question` | 反问揭示 + 细线扩张 | `question`, `sublines[]`, `kicker` |
| `text-lines` | 逐行/逐字文字动画 | `lines[]`, `stagger`, `perChar` |
| `image-scene` | 图片 Ken Burns + 转场 | `src`, `title`, `pan`, `zoomAmount` |
| `shape-motion` | 图形几何动画（grid/rings/nodes/bars/circuit） | `shape`, `label`, `caption` |
| `voice-caption` | 配音 + 词级高亮字幕 | `headline`, `speaker`, `fontSize` |
| `blank` | 纯黑留白（音乐硬停/呼吸） | — |

所有文字组件都带**自动适配排版**：字号过大时会自动折行并缩小，永不溢出画布。

---

## 4. 音乐与音效

全部由 `engine/lib/audio.mjs` **程序化合成**，确定性数学，无第三方版权采样。

配方在 `assets/recipes/<name>.json`：

```json
{
  "durationSec": 9.5,
  "layers": [
    { "gen": "impact", "at": 1.2, "gain": 1.1, "spec": { "startHz": 132, "endHz": 31 } },
    { "gen": "drone",  "at": 0.0, "gain": 0.7, "spec": { "rootHz": 46 } }
  ]
}
```

可用生成器：

| gen | 声音 |
|---|---|
| `impact` | 低频撞击（可调 startHz / endHz / decay / distortion） |
| `riser` | 升压扫频 |
| `drone` | 暗色环境 pad（可调根音、和声、滤波） |
| `ticks` | 数字噪点 |
| `pulse` | 心跳/鼓点（可调 bpm） |
| `swell` | 反向涌起 |
| `silence` | 刻意的空白 |

改配方后重新生成：

```bash
node engine/bin/linvis.mjs audio EP01-LLM-Harness --force
```

**同样的配方必然生成字节完全相同的 WAV**（已验证 md5 一致）。

**做"音乐突然停止"**：在两段之间不放任何发声层，而不是把音量设 0。

---

## 5. 配音与字幕

### 真人配音

1. 把配音文件放进 `projects/<id>/assets/`（wav / mp3 / m4a 均可）
2. 在 `project.json` 的 `audio.layers` 里引用文件名
3. 在 `licenses[]` 登记来源与许可

### 自动字幕

```bash
node engine/bin/linvis.mjs captions EP01-LLM-Harness --audio 配音.wav --model base --language zh
```

- 输出 `assets/captions.json`（段级 + 词级时间戳）
- 自动在 `project.json` 启用 `captions`
- 字幕镜头用 `voice-caption`，会逐词高亮当前发音的词
- 引擎优先 `faster-whisper`，回退 `openai-whisper`（本机已缓存 `base.pt`，可离线）

可用模型：`tiny` / `base` / `small` / `medium`（越大越准，越慢）。
`base` 在 CPU 上约 5 秒转写 5 秒音频。

### 占位配音（仅测试用）

```bash
node tools/make-placeholder-voice.mjs "测试文本" "projects/X/assets/PLACEHOLDER-voice.wav"
```

⚠️ SAPI 中文合成音质很差，转写会识别错乱，**仅用于验证管线**，不能作为最终配音。

---

## 6. 输出规格

| 项 | 值 |
|---|---|
| 分辨率 | 1080×1920（9:16 竖屏） |
| 帧率 | 30 fps |
| 视频编码 | H.264 High / yuv420p / bt709 / tv range |
| 音频编码 | AAC 48kHz 立体声 256kbps |
| 响度 | **-14 LUFS**（EBU R128，社交平台标准），峰值 ≤ -1 dBTP |
| 容器 | MP4（faststart） |

`render` 会自动做响度归一，并把未归一的原始渲染保留为 `*-raw.mp4` 供对比。

---

## 7. 目录结构

```
D:/Linvis-AI-Studio/
├── AGENTS.md                  # 所有 Agent 平台的统一工程规则（唯一权威）
├── engine/
│   ├── bin/linvis.mjs         # CLI 唯一入口
│   ├── lib/
│   │   ├── project.mjs        # 工程加载与校验
│   │   ├── remotion.mjs       # Remotion 渲染桥
│   │   ├── ffmpeg.mjs         # FFmpeg 探测/质检
│   │   ├── audio.mjs          # 程序化音频合成
│   │   ├── postproc.mjs       # 响度归一
│   │   ├── transcribe.mjs     # 转写桥
│   │   └── log.mjs            # 日志
│   ├── py/transcribe.py       # faster-whisper / openai-whisper 双引擎
│   └── schema/project.schema.json
├── video/                     # Remotion 工程（镜头模板）
│   ├── LinvisVideo.tsx        # 主合成（配置 → 时间线）
│   ├── components/primitives.tsx  # 自动排版 / 颗粒 / 扫描线 / 色散
│   └── scenes/*.tsx           # 9 种镜头模板
├── projects/<id>/
│   ├── project.json           # 唯一配置源
│   └── assets/                # 该工程私有素材
├── assets/recipes/            # 可复用音频配方
├── scripts/                   # 独立渲染脚本（cmd / sh）
├── tools/                     # 占位配音 / Skill 验证 / stub 服务
├── .agents/skills/linvis-video/SKILL.md   # Agent Skill 入口
├── .dsh/skills/               # DSH 适配
├── .codex/README.md           # Codex 适配说明
├── .venv/                     # 项目级 Python 隔离环境
└── out/                       # 渲染产物与日志（可安全删除）
```

---

## 8. 平台入口

### Cindy / Pi

Skill 已实测被加载。**但要注意两层目录的区别**：

| 层级 | 路径 | 设置页可见 | 何时生效 |
|---|---|---|---|
| 项目级（源） | `.agents/skills/linvis-video` | ❌ | 仅以本目录为工作目录 + 项目信任 |
| 用户级（链接） | `~/.agents/skills/`、`~/.claude/skills/` | ✅ | 任何目录 |

已在用户级建好 Junction（指向项目内唯一源文件，非副本）。若在**另一台机器**或**重装后**
设置页看不到，执行：

```bash
node tools/register-skill.mjs
```

然后重启 Cindy。

在 Cindy 里直接说需求即可（如"把 EP01 的标题改掉重渲染"），或强制加载：

```
/skill:linvis-video 渲染 EP01-LLM-Harness
```

验证 Skill 是否真的被加载（零成本、不调用模型）：

```bash
node tools/verify-pi-skill.mjs
```

### 独立命令行（不启动任何 Agent）

```bat
scripts\render-standalone.cmd EP01-LLM-Harness
```

```bash
bash scripts/render-standalone.sh EP01-LLM-Harness
```

这两个脚本会显式清除 `CINDY_HOME` / `CODEX_HOME` / `DSH_HOME` 等环境变量，
证明引擎完全不依赖任何 Agent 平台。

### Codex

直接打开本目录，Codex 会读 `AGENTS.md`，然后执行同样的 `node engine/bin/linvis.mjs ...` 命令。
详见 `.codex/README.md`。**状态：待验证**。

### DSH

见 `.dsh/skills/linvis-video.md`。**状态：待验证**。

---

## 9. 常见问题

**渲染报 "Module not found"**
→ 检查 `node_modules` 是否完整：`npm install`

**渲染卡在 browser 下载**
→ 引擎优先用系统 Chrome/Edge。若都没有，设 `LINVIS_BROWSER` 环境变量指到浏览器 exe。

**中文显示成方块**
→ 检查 `video/public/fonts/NotoSansSC-VF.ttf` 是否存在。

**字幕转写失败，报 HF CDN 连接错误**
→ 引擎会自动回退到本地缓存的 `openai-whisper` 模型。若都失败，手动指定：
`py engine/py/transcribe.py --audio X --out Y --engine openai-whisper`

**响度没到 -14 LUFS**
→ 说明素材本身动态余量太小或已被限幅。检查 `out/logs/*-render.log` 里的
  `响度: X → Y LUFS` 行。若显示"已达标"则无需处理。

**想改视频尺寸/帧率**
→ 改 `project.json` 的 `video.width/height/fps`，但竖屏 9:16 是设计目标，改了排版可能不最优。

---

## 10. 回滚

本工程对系统没有任何侵入式修改：

- 依赖只在项目级 `node_modules/` 与 `.venv/`
- 未修改任何 Agent 平台源码或配置
- 删除 `out/` 只丢失渲染产物
- 删除 `.dsh/` 与 `.codex/` 只是去掉适配层
- 删除整个 `D:/Linvis-AI-Studio` 即可完全还原（工程文件建议先备份 `projects/`）
