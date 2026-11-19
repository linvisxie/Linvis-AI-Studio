---
name: linvis-video
description: Linvis AI Studio 本地视频引擎。制作/修改/渲染竖屏 AI 视频：检查环境、创建工程、生成音乐音效、语音转字幕、预览、渲染 MP4、质检输出、导出剪映原生可编辑草稿、口播侧链压缩。Use when 用户要制作视频、改镜头、加字幕、生成配乐、渲染、导出到剪映精修、或处理口播配音与 BGM 混音。
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
node engine/bin/linvis.mjs scenes <project>           # 逐镜头分段渲染
node engine/bin/linvis.mjs jianying <project> --name <n>  # 导出剪映原生可编辑草稿
node engine/bin/linvis.mjs jianying inspect <n>       # 检查剪映草稿完整性
node engine/bin/linvis.mjs duck <project> --compare   # 口播侧链压缩 BGM
node engine/bin/linvis.mjs voice <project> --audio <录音> # 非破坏性整理真人录音
node engine/bin/linvis.mjs handoff <project>          # 自包含素材、SRT、时间轴交接包
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
| `video-scene` | 真正解码视频素材 | `src`, `startFrom`（源帧）, `volume`, `fit` |
| `concept-scene` | 科技哲学概念动画 | `variant`, `title`, `subtitle`, `labels[]`, `src` |

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

## 6.5 导出剪映原生草稿（V1.1）

把工程导出成本机剪映可逐轨编辑的草稿，用户在里面精修后手动导出 MP4。

```bash
node engine/bin/linvis.mjs jianying <project> --name <草稿名>
node engine/bin/linvis.mjs jianying inspect <草稿名>
```

**轨道映射**

| project.json | 剪映 |
|---|---|
| `audio.layers[]` | 每条独立音频轨（配音 / BGM / 音效各自可调） |
| `scenes[].props.image`、`.src` | 画面轨片段 |
| `scenes[].props.text` 等文案 | 标题文字轨，每镜头一条 |
| `captions`（whisper 结果） | 字幕轨，**每句一条**，可逐句改 |

**必须知道的规则**

1. 写的是**明文** `draft_content.json`。剪映自己保存时加密。
   **不要试图在进程外解密 11.7 草稿** —— 它用会话级动态熵，静态调用恒失败。
2. schema 骨架取自**本机剪映自己创建过的草稿**，因此版本恒为当前版本。
   会自动剔除骨架里的 `draft_meta_info.json`、`draft_cover.jpg`、`.backup`、旧时间线目录
   —— 带着它们会让剪映把新草稿认成源草稿，报「草稿列表异常」，甚至覆写用户原草稿。
3. 素材会**复制到草稿的 `media/` 下**，使用内容哈希命名及绝对路径引用。移动草稿后需重建引用，不能宣称可任意搬迁。
4. **动画镜头需要先分段渲染**。`impact-title` / `cold-open` / `dissolve` 等
   没有静态素材，必须先跑 `linvis scenes <project>` 产出逐镜头片段，
   适配器会自动引用它们。若未渲染，草稿只保留这些镜头的文字层并打印警告。
5. 草稿正被剪映打开时（存在 `.locked`）拒绝覆盖，必须先在剪映里关闭。

**限制（必须如实告知用户）**

- 仅实测剪映 **11.7.0.14652**，其他版本 `待验证`。
- 剪映 7+ 不支持自动导出 MP4，需用户在剪映里手动导出。

---

## 6.6 口播侧链压缩

真人说话时自动压低 BGM，说完平滑恢复。

```bash
# 在 project.json 的 audio.layers 里标 role
#   {"id":"voice","role":"voice","src":"录音.wav"}
#   {"id":"bgm","role":"music","src":"bgm.wav","volume":0.25}

node engine/bin/linvis.mjs duck <project> --compare
```

输出 `projects/<id>/assets/<id>-ducked.wav`（配音与音乐混合的审听版）；同时输出独立音乐 stem。`--compare` 额外输出 `.flat.wav` 供 A/B 试听。最终配置保留独立配音与音乐 stem，**不能把混合审听版和配音再叠加**。已应用配置增益的 stem 通常以 `volume:1` 引用，避免二次衰减。

参数：`--threshold 0.05 --ratio 8 --attack 20 --release 400 --musicGain 1.0 --voiceGain 1.0`

实测（96 帧 RMS）：76 帧音乐被压低，均值 -1.93 dB，最深 -9.68 dB，压低深度与人声强度正相关。

---

## 6.7 可编辑交接与 OpenChatCut

```bash
node engine/bin/linvis.mjs scenes <project>
node engine/bin/linvis.mjs handoff <project>
node tools/verify-handoff.mjs out/handoff/<project>
```

- editor 镜头是静音、无全局/口播烧录字幕的画面；画面内的设计标题仍属于动画。
- 片段仅在配置、素材、渲染代码、渲染参数及文件哈希全部匹配时复用；禁止只按文件名存在判断。
- 配音、音乐及校对短句 SRT 独立交接。复杂动画内部对象仍在 Remotion 源配置中编辑，不会自动变成剪辑器原生图层。
- OpenChatCut 使用其授权 MCP：指定独立项目 → 新建编辑会话 → 导入素材 → 构建时间轴 → review 提交 → **全新 transport 回读**。本机 0.2.17 离线绑定在提交后再次 begin 会 stale；每轮必须重新 initialize，不能忽略版本保护。
- Cindy 已缓存连接不可用时，使用统一 CLI 的本机官方 MCP 适配器，不要求用户删配置，也不读取私有数据库或修改宿主源码：
  ```bash
  node engine/bin/linvis.mjs openchatcut status
  node engine/bin/linvis.mjs openchatcut self-test
  node engine/bin/linvis.mjs openchatcut push <project> --package <允许导入的交接包目录> --editor-project <id> --name <新的序列名称>
  node engine/bin/linvis.mjs openchatcut verify --package <交接包目录> --editor-project <id>
  ```
- `push` 只新建序列，同名拒绝；保存结果未知时不重放，先 inspect/verify。鉴权只在内存中使用官方本机客户端文件，不显示或复制 Token。大结果使用 `read_agent_artifact` 分页、连续性/长度/SHA256 校验后才能验收。
- 本适配器的字幕是独立原生文字片段，不冒充内置 C1 自动字幕系统；画面/配音/音乐/字幕分别可编辑。准确报告 API 持久化、GUI 重开和实际播放各自的验证状态。详见 `docs/OPENCHATCUT-INTEGRATION-STATUS.md`。
- JSON 时间轴只是交接说明，不代表已经导入。FCPXML 的目标编辑器兼容性必须单独实测；OpenChatCut 的 `import_timeline` 不导入字幕/标题，字幕仍需单独建立。
- 录音只覆盖部分稿件时只交付已录制范围；不能用合成配音冒充整集完成。

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

## 8.5 完整工作流（从创意到剪映）

用户给一个视频任务时，按这个闭环走，不要跳步：

| 步 | 做什么 | 命令 / 产物 |
|---|---|---|
| 1 | 生成脚本与分镜 | 写 `projects/<id>/project.json` 的 `scenes[]` |
| 2 | 设计镜头 | 选镜头类型 + 文案 props（见 §4 表） |
| 3 | 整理真人配音 | 用户录音放入 `assets/`，`audio.layers` 标 `role:"voice"` |
| 4 | 生成字幕 | `linvis captions <id> --audio <录音> --language zh` |
| 5 | 混音 | `linvis duck <id> --compare`（口播必做） |
| 6 | 出预览与成片 | `linvis preview` → `linvis render` → `linvis inspect` |
| 6.5 | 逐镜头分段渲染 | `linvis scenes <id>`（剪映要逐轨编辑时必须做） |
| 7 | 生成剪映草稿 | `linvis jianying <id> --name <名>` |
| 8 | 质检草稿 | `linvis jianying inspect <名>` |
| 9 | 用户反馈后只改指定镜头 | 只动 `scenes[]` 里那一项 props |
| 10 | 重出草稿与 MP4 | 回到第 6、7 步 |

**关键纪律**

- 有真人录音时**必须**用真人录音做验收，不得用 SAPI 合成音冒充。
- 没录音时可以先做技术准备，但要在报告里写「真人录音验收：待用户提供录音后验证」。
- 第 9 步是效率关键：用户说「第 2 句字幕错了」，只改那一条，不要重写整个工程。

---

## 9. 报告纪律

- 只有实际跑过并有输出，才能说"完成"。
- 未验证的能力（如 Codex / DSH 的 Skill 加载）必须标 `待验证`。
- 不要声称做了没做的事；不要把占位当成品。
