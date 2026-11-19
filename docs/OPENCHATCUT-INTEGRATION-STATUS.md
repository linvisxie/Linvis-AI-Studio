# OpenChatCut 接入诊断与修复验收

验证：2026-11-07 UTC（本机 2026-11-08）。

## 结论

**OpenChatCut 的官方 MCP 服务和鉴权正常。Linvis 已通过本机 CLI 适配器跑通完整第一幕的编辑、提交和全新连接回读。**

这不是修补 Cindy 源码，也不代表 Cindy 当前已缓存的 `custom_openchatcut` transport 被热修复。当前缓存工具调用依然报错；工作流现在通过 `linvis openchatcut` 使用**同一台电脑、同一个官方 MCP 服务、同一个工程**，自行管理连接生命周期，不再依赖用户手动刷新 Cindy。

## 1. 查明的故障层次

| 层次 | 实测证据 | 判断 |
|---|---|---|
| 服务存活及鉴权 | 官方本机客户端全新 initialize 与 status 成功 | 不是软件不可用，也不是现有 Token 失效 |
| 原素材/工程 | 全新连接读回此前提交的首个 120 帧镜头，素材 linked | 首次提交确实持久化了 |
| 同连接连续编辑 | 独立测试工程提交后，用同一 transport 再 begin，明确返回版本/ownership stale | 离线 transport 的旧工程绑定不能跨提交继续使用 |
| 全新连接连续编辑 | 两轮分别 initialize → 编辑 → applied → 新连接回读均成功，持久化 2 个精确帧片段 | 按事务创建连接可以稳定完成连续两轮 |
| Cindy 已缓存连接 | OpenChatCut 重启后原工具仍报 `MCP tools/call returned an error`，但独立客户端成功 | 问题局限于该已缓存调用链；没有证据证明需要删除配置/更换密钥 |
| 大结果读取 | 34 项时间线返回 `archived:true`，不是 timeline 字段 | 必须用官方 `read_agent_artifact` 分页读取，再校验连续性、总长度和 SHA256 |

边界：没有对应用源码打补丁，未根据未取得的底层 HTTP 日志断言 Cindy 内部具体哪行代码有缺陷。以前建议的“关开开关”“原样保存即可重连”在这个版本界面中不成立，已撤回。

## 2. 实现的解决方案

新增 `engine/adapters/openchatcut/client.mjs`、`index.mjs`，接入统一 `linvis` CLI。

- 通过公开 Streamable HTTP MCP 协议连接本机 `127.0.0.1:5199`。
- 使用安装说明及已有官方诊断脚本约定的本机鉴权文件；凭据只在内存中用于 Authorization，不输出、不复制、不写回。
- endpoint 限制为本机 HTTP，不向第三方发送媒体或鉴权信息；endpoint 命令行参数也在日志入口脱敏。
- 每个编辑事务使用新的 initialize/transport；提交确认后，**另建连接**读取持久化结果。
- 不自动重放修改；提交超时/回读失败时记录“结果未知”或“已提交但验证未完成”，保留 timelineId，禁止盲目再导入。
- 只新建时间线，不清空/覆盖现有时间线；同名时间线直接拒绝重复导入。
- 音频取“源帧数”和“工程剩余帧数”的较小值，避免把整条时间线撑长。
- 验收不仅数片段，还检查实际素材池 id、解析 id、源窗口、轨道、起点、时长、音量/淡入淡出、字幕内容/位置及工程总长。

没有读取私有工程数据库，没有修改 Cindy/OpenChatCut 程序，没有关闭安全策略，没有重启 Cindy，没有删除/重新添加 MCP 配置。

## 3. 第一幕实际交付

工程：`0c0f2579-ed78-4002-9392-487f177486fc`

工程名：`Linvis EP01 · 科技与哲学 · 第一幕精修 v2`

新时间线：`Linvis 第一幕42秒 · 独立音轨与字幕`

时间线 id：`tl_c38b3c75-121a-40ec-bda5-a85d079d9c5e`

| 内容 | 已提交且新连接回读 |
|---|---|
| 画面 | 10 个静音镜头，精确起点/帧数与交接包一致 |
| 配音 | 独立 A1，1250 帧，增益 1，源从 0 开始 |
| 音乐 | 独立 A2，1236 帧，增益 1，淡入 15 帧、淡出 24 帧 |
| 字幕 | V2 上 22 条原生、逐句可编辑的文字片段，字号 52，纵向位置 30% 偏移 |
| 工程 | 1080×1920、30fps、1260 帧（42 秒） |
| 素材链接 | 素材名称中的内容哈希、pool id、resolved id、源窗口均核对 |
| 原序列 | `序列 1` 的全部片段数据与导入前快照逐字段完全一致 |

字幕是**独立原生文字片段**，不是烧录在画面中的口播字幕，也没有冒充 OpenChatCut 内置 C1 自动转录字幕系统。复杂动画内部仍由 Linvis/Remotion 源配置编辑。

### 验收证据

- `out/occ-lifecycle-selftest.json`：同连接 stale 的复现、两轮 applied、新连接持久化回读。
- `out/occ-ep01-push.json`：实际提交状态 applied、34 项时间线、新连接回读结果。
- `out/occ-ep01-verified.json`：加强后的素材 id、音轨增益/淡入淡出、字幕及帧范围独立核对。
- `out/occ-persisted-before.json` 与 `out/occ-original-sequence-after.json`：原序列片段未改。
- `out/occ-all-tests.log`：56 项通过、0 失败、0 跳过，含真实 Remotion smoke；TypeScript 检查通过。
- 实际再次运行同名 push 已被拒绝，没有新增重复时间线或提交修改。

为重现连接生命周期，创建了名称以 `Linvis MCP lifecycle check` 开头的独立测试工程；没有删除它们或操作原有用户工程。

## 4. 可复跑命令

```bash
# 服务/鉴权及全新连接是否正常
node engine/bin/linvis.mjs openchatcut status

# 两轮编辑、保存及全新连接回读（会新建独立诊断工程）
node engine/bin/linvis.mjs openchatcut self-test

# 回读实际工程
node engine/bin/linvis.mjs openchatcut inspect --editor-project 0c0f2579-ed78-4002-9392-487f177486fc

# 按交接包严格核对已提交时间线；不修改时间线
node engine/bin/linvis.mjs openchatcut verify --package D:/OpenChatCut/projects/Linvis-EP01-Act1-v2-Integrated --editor-project 0c0f2579-ed78-4002-9392-487f177486fc

# 以后导入新版本：先 scenes/handoff，再选择全新的序列名称
node engine/bin/linvis.mjs openchatcut push EP01-TechPhilosophy-Act1-v2 --package D:/OpenChatCut/projects/Linvis-EP01-Act1-v2-Integrated --editor-project 0c0f2579-ed78-4002-9392-487f177486fc --name "另一个明确的新版本名称"
```

交接包应使用 `linvis handoff` 生成在 OpenChatCut 允许导入的本地目录，不修改白名单来绕过导入保护。此集仍只有第一幕真人录音，没有自动补成完整八幕。

## 5. 尚未声称完成

- Cindy 原来的已缓存工具连接没有热修复；未来正常新建/重启 Agent 运行时后的工具恢复，需要另行验证。当前工作流已不依赖这一步。
- GUI 打开/播放、真人听音、从 OpenChatCut 导出 MP4：未验证。尝试通过无障碍打开最小化窗口时，窗口仍保持最小化，未使用物理输入绕过该限制。
- 新 MCP 连接回读不等于应用重启后的 GUI 验收；目前能够确认的是服务端持久化、精确素材/时间线数据及连续两轮事务。
- FCPXML 在目标编辑器的直接导入仍是单独待验证能力；本次实际时间线使用官方 MCP 原生操作构建，不依赖 FCPXML 导入。
