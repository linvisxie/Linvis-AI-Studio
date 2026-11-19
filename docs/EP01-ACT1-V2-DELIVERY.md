# EP01 第一幕 v2：交付与工作流验收

日期：2026-11-06。范围：42 秒第一幕真人试录样片，**不是完整八幕第一集**。

**后续进展（本机 2026-11-08）：OpenChatCut 官方 MCP 已通过 Linvis CLI 恢复稳定事务，并实际提交 10 镜头、2 音轨、22 条原生字幕文字及全新连接回读。下面第 4 节是当时的阻塞历史；当前结论与准确验收边界见 [接入诊断报告](OPENCHATCUT-INTEGRATION-STATUS.md)。**

## 1. 交付位置

仓库：`D:/Linvis-AI-Studio`。

| 内容 | 相对路径 | 状态 |
|---|---|---|
| 第一幕成片 | `out/render/EP01-TechPhilosophy-Act1-v2-final.mp4` | 渲染与技术质检通过 |
| 唯一源配置 | `projects/EP01-TechPhilosophy-Act1-v2/project.json` | 10 个镜头，1260 帧 |
| 自包含交接包 | `out/handoff/EP01-TechPhilosophy-Act1-v2/` | 素材哈希、配置引用、镜头帧数/静音检查通过 |
| 标准时间线 | 交接包内 `timeline.fcpxml` | 已生成；编辑器实际导入待验证 |
| 字幕 | 交接包内 `captions.srt` | 22 条校对语义短句；不是逐字强制对齐 |
| 剪映备用草稿 | `out/jianying/Linvis-EP01-Act1-v2-Delivery/` | 4 轨、34 片段引用、12 媒体文件；文件检查通过，GUI 打开待验证 |
| 原稿提取文本 | `projects/EP01-TechPhilosophy-Act1-v2/script-source.txt` | 全部八幕保留 |

剪映草稿没有注册进用户原有草稿列表，未打开或改写已有草稿。其媒体使用绝对路径，移动后需重建草稿；缺少 `draft_meta_info.json`，剪映可能需要重新索引。不要把文件检查通过当成 GUI 重开成功。

## 2. 成片验收

- 1080×1920、30fps、1260 视频帧、容器约 42.005 秒。
- H.264 High、yuv420p、AAC 48kHz 双声道。
- 整体响度 -14.31 LUFS，True Peak -1.59 dBTP；`linvis inspect` 10/10 通过。
- 相同配置第二次完整渲染：ffprobe 关键参数一致，两个交付 MP4 的 SHA256 一致。
- 10 个 editor 片段：120、171、148、112、152、89、138、143、55、132 帧；均无音频轨。
- 21 项自动测试通过、0 失败、0 跳过，包含真实 Remotion 1/3 帧静音渲染与缓存复用；TypeScript 检查通过。
- 已查看抽帧构图，未进行逐帧 GUI 播放和真人听音验收，不能把技术质检等同于用户审美/听感确认。

证据：`out/ep01-inspect.json`、`out/ep01-handoff-verification.json`、`out/ep01-tests-full.log`、`out/jianying-export.log`、`out/jianying-inspect.json`。

## 3. 工作流实际改进

1. 真实录音非破坏性整理：保留原始 M4A，另生成 `voice-clean.wav`。原文件 SHA256：`f92578b6ecd114b59b72c09e490622059829d83adbae04dc19ba22d3a0df8451`。
2. 配音驱动音乐侧链，独立 music stem；最终只用配音与 music stem，审听混音不再与配音重复叠加。
3. final/editor 渲染分离：editor 不含全局字幕、口播烧录字幕及音轨。设计标题仍烧录在画面中。
4. 配置、源素材、代码、参数与片段文件哈希联合验证缓存；过期/损坏片段不假报有效。
5. 修复闭区间多一帧问题、同名素材碰撞、字幕溢出分页与 `props.image` 引用。
6. 增加科技哲学概念模板；`video-scene` 使用真正视频解码组件（本片没有用到该类型，不宣称本片完成了该类型实拍素材验收）。
7. 交接包包含哈希素材、可由 Linvis 重渲的配置、22 条 SRT、时间线 JSON，以及可选 FCPXML。
8. 修复 handoff CLI 漏传镜头目录和便携配置错误的 `assets/` 双前缀；已从便携配置实际导出验证帧。

复杂动画中的点、线、图形和设计标题仍在 Remotion/配置中编辑，不会被伪装成剪辑器原生对象。更改画面动画需要重新渲染该源工程并更新交接；独立剪辑片段可在编辑器中裁切/调速/重排。

## 4. OpenChatCut：当时未完成的部分（历史记录）

独立工程：`0c0f2579-ed78-4002-9392-487f177486fc`，名称 `Linvis EP01 · 科技与哲学 · 第一幕精修 v2`。

曾成功建工程并在草稿会话中导入录音和两张图。随后服务返回：

> Stored project ... changed ownership or revision during the offline edit. Start a new MCP session.

当前 transport 为 offline、无在线 editor；重新 begin/target/discard 都无法解除 stale。宿主发现只提供 MCP 配置表单，没有本任务可调用的 transport 重连操作。因此：

- **未提交完整时间线；未验证素材导入已经持久化。**
- 未伪造完成回执，未通过私有数据库或凭据绕过会话限制。
- 恢复方式：在 Cindy 的 MCP 设置中重新连接 OpenChatCut，再重新定位上述独立工程、新建 edit session，导入包内 10 个静音 MP4 与两条音频，构建时间线，单独建立 22 条字幕，review 提交后回读持久化状态。
- FCPXML 仅是备用标准交换路径；需先导入匹配素材。OpenChatCut `import_timeline` 不导入字幕/标题；gain/fade 和源窗口均需回读核实。FCPXML fade 只写 metadata，必须在目标编辑器重建；不能承诺与成片自动完全相同。

## 5. 八幕完整片：逐幕准备清单

| 幕 | 表达与画面方案 | 当前缺口 |
|---|---|---|
| 1 开场问题 | 狗的反差钩子→能力网格→聊天框→人机镜像→反问 | 42 秒样片已出；需用户听感/节奏反馈 |
| 2 如何理解智能 | 预测下词/误差/上下文的并列动画；脑与模型示意分屏 | 真人录音；2022 Nature Neuroscience、2025 Nature Communications 原文 DOI/作者/结论逐项核对 |
| 3 只有 LLM 不够 | 模型被困在聊天框；感知、记忆、行动节点逐个接入 | 真人录音；能力边界表述审校 |
| 4 LLM + Harness | 核心模型→记忆/工具/约束→规划/行动/反馈循环 | 真人录音；Anthropic 2025 长期 Agent 工程文章精确出处；避免把比喻当人体等同 |
| 5 身体与智能 | 人体/环境闭环与虚拟工具闭环并置 | 真人录音；具身认知参考与许可明确的素材或原创示意图；明确工具调用不等于具身认知 |
| 6 从理论到现实 | 真正录下 Cindy 提出目标→OpenChatCut 操作→回读→修正 | 真人录音；必须先修复 MCP 并成功提交/回读/重开，再录真实演示；不拿概念动画冒充录屏 |
| 7 Human？ | LLM + Harness = Human？公式；“功能相似 ≠ 主观体验相同”双列 | 真人录音；2024 NeurIPS 具体论文、意识指标及困难问题参考核查；保留问号 |
| 8 重新理解智能 | 稀疏网络拉远→人与环境→Linvis 标识 | 真人录音；正式 Logo/字标（未提供时用文字署名，不捏造商标素材） |

稿件提到的论文在本轮尚未完成外部原文核查，不登记虚构作者/DOI，不把插画当科学实验影像。

### 时长必须先确定

提取稿共 4015 字符（含方向说明）；剔除幕标题、画面/表演提示与空白，约 3257 口播字符。按每分钟 240–300 字粗估 **10.9–13.6 分钟**，尚未计入停顿；英文混排和实际语速会影响结果。这与稿头的“2 分 30 秒～3 分钟”冲突。

两个可行方向：

- 保留论证完整性：做约 11–14 分钟长视频，按幕录制、剪辑；实际时长由真人录音决定。
- 保留抖音 3 分钟目标：先压缩到约 700–900 字，再录音；或拆成多条系列。不要为卡时长盲目加速八幕录音。

优先需要：确认成片时长方向、提供后七幕真人录音、确认第六幕真实演示内容、提供可核对文献线索与正式标识。

## 6. 可复跑命令

```bash
node engine/bin/linvis.mjs doctor
node engine/bin/linvis.mjs render EP01-TechPhilosophy-Act1-v2
node engine/bin/linvis.mjs inspect EP01-TechPhilosophy-Act1-v2
node engine/bin/linvis.mjs scenes EP01-TechPhilosophy-Act1-v2
node engine/bin/linvis.mjs handoff EP01-TechPhilosophy-Act1-v2 --fcpxml --force
node tools/verify-handoff.mjs out/handoff/EP01-TechPhilosophy-Act1-v2
LINVIS_RENDER_TEST=1 node --test engine/tests/*.test.mjs
npx tsc --noEmit
```

Windows PowerShell 跑真实 smoke 前使用 `$env:LINVIS_RENDER_TEST='1'`。最后两条是开发测试，不是视频生产的旁路。FCPXML 内含绝对 file URL，搬迁目录后需要以新目录为 baseDir 重新生成或在编辑器重连媒体；交接包的 project.json 与素材本身是相对引用。导出文件不等于编辑器导入成功。
