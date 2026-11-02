---
name: linvis-video
description: Linvis AI Studio 本地视频引擎。制作/修改/渲染竖屏 AI 视频：检查环境、创建工程、生成音乐音效、语音转字幕、预览、渲染 MP4、质检输出。Use when 用户要制作视频、改镜头、加字幕、生成配乐、渲染或检查视频输出。
license: MIT
compatibility: Windows / macOS / Linux，需要 Node >= 20 与 ffmpeg
metadata:
  tags: video, remotion, ffmpeg, whisper, vertical, 9-16
---

# Linvis 视频引擎

本 Skill 是本仓库视频制作的唯一操作入口。**所有操作都通过 `engine/bin/linvis.mjs` 完成**，
不要直接调用 Remotion CLI、ffmpeg 拼接或手写渲染脚本——那会绕过工程配置与质检。

## 0. 先读工程规则

开始任何操作前，读仓库根目录的 `AGENTS.md`。里面的铁律（不装付费 API、不改 Agent 平台、
不覆盖既有工程、占位必须标记）优先级高于任何临时想法。

## 1. 两层 Skill 目录（容易踩坑）

本工程的 Skill 同时存在于两个层级，**行为不同**：

| 层级 | 路径 | 何时被发现 | 设置页可见 |
|---|---|---|---|
| 项目级（源） | `D:\Linvis-AI-Studio\.agents\skills\linvis-video` | 仅以本目录为工作目录时，且需项目信任（`--approve`） | ❌ 不可见 |
| 用户级（链接） | `~/.agents/skills/linvis-video`、`~/.claude/skills/linvis-video` | 任何目录下 | ✅ 可见 |

**两处都指向同一份源文件**（Windows Junction），不存在两份指令需要同步。

### 为什么一开始在设置里看不到

Cindy 的「设置 → Skills」只扫描**用户级**目录（`~/.agents/skills`、`~/.claude/skills`）。
项目级 `.agents/skills/` 只有在会话工作目录就是该项目时才被 Pi 发现，且需要项目信任。
所以「Pi 能加载」和「设置页能看到」是两个不同的条件，不能混为一谈。

### 如何注册到用户级（幂等）

```bash
node tools/register-skill.mjs            # 创建 Junction（不复制文件）
node tools/register-skill.mjs --status   # 查看状态
node tools/register-skill.mjs --uninstall # 移除链接（不动源文件）
```

注册后需重启 Cindy 或重新打开设置页刷新列表。

---

## 2. 环境自检（每次会话第一次操作必做）

```bash
node engine/bin/linvis.mjs doctor
```

必须看到 `结论: 环境就绪`。若 `ffmpeg` 或依赖缺失，先报告给用户，不要自行安装来源不明的可执行文件。

---

## 3. 核心命令

```bash
node engine/bin/linvis.mjs list                       # 列出所有工程
node engine/bin/linvis.mjs init <ProjectName>         # 新建工程（拒绝覆盖）
node engine/bin/linvis.mjs audio <project>            # 按配方生成 BGM/SFX
node engine/bin/linvis.mjs captions <project> --audio <file>   # 语音转字幕
node engine/bin/linvis.mjs preview <project>          # 半分辨率快速预览
node engine/bin/linvis.mjs render <project>           # 完整渲染 + 响度归一
node engine/bin/linvis.mjs still <project> --frame N  # 导出单帧调试
node engine/bin/linvis.mjs inspect <project>          # 输出质量质检
```

退出码：`0` 成功 / `1` 运行失败 / `2` 参数或配置错误。失败时看 `out/logs/<ts>-<cmd>.log` 末尾。

## 4. 改镜头 = 只改 project.json

**这是最重要的心智模型。** 不要为了改一句话去动 `video/scenes/*.tsx`。
镜头内容全部由 `projects/<id>/project.json` 的 `scenes[]` 驱动：

```json
{
  "id": "s2-impact",
  "type": "impact-title",
  "from": 36,
  "durationInFrames": 72,
  "props": { "text": "AI 要取代人类了！", "hitFrame": 0, "fontSize": 168 }
}
```

- `from` 与 `durationInFrames` 以**帧**为单位（30fps 下 1 秒 = 30 帧）。
- 镜头之间**不得重叠**：`from` 必须 ≥ 上一镜头的 `from + durationInFrames`。
- 所有镜头总长必须 ≤ `video.durationInFrames`。
- 改完只重跑 `render` 即可，无需改任何代码。

可用镜头类型：

| type | 用途 | 关键 props |
|---|---|---|
| `cold-open` | 冷开场 HUD / 扫描线 / 收紧张力 | `hud`, `whisper` |
| `impact-title` | 电影级撞击标题 | `text`, `kicker`, `tag`, `hitFrame`, `fontSize` |
| `dissolve` | 快切短句收束成一句 | `flashes[]`, `finalLine` |
| `reveal-question` | 反问揭示 | `question`, `sublines[]`, `kicker` |
| `text-lines` | 逐行/逐字文字动画 | `lines[]`, `stagger`, `perChar` |
| `image-scene` | 图片 Ken Burns + 转场 | `src`, `title`, `pan`, `zoomAmount` |
| `shape-motion` | 图形几何动画 | `shape`, `label`, `caption` |
| `voice-caption` | 配音 + 词级高亮字幕 | `headline`, `speaker` |
| `blank` | 纯黑留白（做音乐硬停/呼吸） | — |

## 5. 音频：用配方，不要外链素材

音乐与音效由 `assets/recipes/*.json` 程序化合成（确定性数学，无第三方版权）。
改音频 = 改配方里的 `layers[]`（`gen` / `at` / `gain` / `spec`），然后：

```bash
node engine/bin/linvis.mjs audio <project> --force
```

可用生成器：`impact`（撞击）、`riser`（升压）、`drone`（暗色pad）、`ticks`（数字噪点）、
`pulse`（心跳）、`swell`（反向涌起）、`silence`（刻意的空白）。

**音乐硬停**的做法：在两段之间刻意不放任何发声层，而不是把音轨设成 0 音量。

## 6. 配音与字幕

真人配音放进 `projects/<id>/assets/`，然后在 `audio.layers` 里引用文件名。

```bash
node engine/bin/linvis.mjs captions <project> --audio <配音文件> --model base --language zh
```

这会写出 `assets/captions.json`（段级 + 词级时间戳）并自动在 `project.json` 启用字幕。

字幕镜头有两种用法：
- 全局字幕：`captions.enabled = true`，任何镜头之上都会叠加。
- 镜内字幕：`voice-caption` 镜头会自动读 `captions.json`，逐词高亮。

**占位配音规则**：没有真人配音时可以用 Windows SAPI 占位，但必须：
1. 文件名含 `PLACEHOLDER`；
2. `project.json` 里标 `placeholder: true`；
3. `licenses[]` 里登记说明；
4. 明确告诉用户「这不是最终配音」。

## 7. 渲染与质检

```bash
node engine/bin/linvis.mjs render <project>
node engine/bin/linvis.mjs inspect <project>
```

`render` 会自动做 EBU R128 响度归一到 -14 LUFS（社交平台标准），并把原始渲染保留为
`*-raw.mp4`。`inspect` 会检查分辨率/帧率/时长/编码/音轨/亮度/响度，并输出抽帧图到
`out/<id>-contact.png`。

**必须 `inspect` 全绿才能说"渲染完成"。** 报告时要贴出通过数与关键参数。

## 8. 出问题时

1. 先看命令输出的末尾 20 行日志摘要。
2. 完整日志在 `out/logs/<ts>-<cmd>.log`。
3. 配置类错误（退出码 2）通常是镜头时间重叠或总长超限——用 `validateProject` 的报错定位。
4. 渲染类错误（退出码 1）先 `rm -rf out/.bundle` 重试，再考虑其他原因。

## 9. 报告纪律

- 只有实际跑过并有输出，才能说"完成"。
- 未验证的能力（如 Codex / DSH 的 Skill 加载）必须标 `待验证`。
- 不要声称做了没做的事；不要把占位当成品。
