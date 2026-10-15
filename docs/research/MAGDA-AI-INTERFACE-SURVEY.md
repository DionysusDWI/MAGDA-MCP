# MAGDA 内置 AI 可调用接口普查 —— 兼 MCP 工具设计参考

> 任务槽：`tasks/20261015-02_magda-ai-tool-surface/` ｜ 类型：study ｜ 日期：2026-10-15
> 对象：**MAGDA**（Conceptual Machines 的开源编曲软件，上游仓 `Conceptual-Machines/magda-core`）
> 本地安装：`F:\MAGDA`（`MAGDA.exe` v0.20.2）
>
> ⚠️ 用户原话写的是「MEGDA」，上游项目名实为 **MAGDA**，本文一律用上游名。

---

## 0. 结论（先给数字）

**MAGDA 内部有一张统一的「远程 API 操作注册表」`OperationRegistry`，共 158 个操作。
其中 154 个逐个投影成 MCP 工具，另外 4 个是传输层的订阅动词、不作为工具暴露。**

| 面 | 数量 | 说明 |
|---|---|---|
| 注册表操作（`OperationRegistry`） | **158** | **26 个域**，源码 `magda/daw/api/remote_api.cpp` |
| **MCP 工具**（`tools/list`） | **154** | 「每个非 transport-scoped 操作 = 一个工具」（`docs/remote-api-mcp.md:263`） |
| MCP 资源（`resources/list`） | **12** | 8 个固定 URI ＋ 4 个模板，全部是「读操作 + URI」 |
| 订阅主题（topic） | **11** | `project tracks clips devices selection transport session automation jobs meters playhead` |
| 权限域（scope） | **5** | `read`（默认）· `edit` · `transport` · `session` · `hardware-midi` |
| transport-scoped 动词（不进工具表） | **4** | `subscriptions.subscribe/.unsubscribe/.list/.resync` |
| 工具访问级 | 读 38 · 写 105 · 控制 11 | `OperationAccess::{Read,Write,Control}` |
| 应用内 AI agent 实现 | **16** 个具体 agent ＋ 4 个运行时文件 | `magda/agents/` 共 20 个文件 |
| 可配置的 agent 角色 | **6** | `chord command controller faust music theme`（`config.json` → `ai.agents`） |

**最有参考价值的一条事实**：MAGDA 的应用内 AI 助手（右侧 AI Chat 控制台）**不另建一套工具表**，
而是直接复用同一张 `OperationRegistry` 做 function calling
（`magda/agents/agent_tool_bridge.cpp:13`）。
也就是说 **154 个 MCP 工具 = MAGDA 自己认为「一个 DAW 该暴露给 AI 的全部动作」**，
而且是同一份定义同时服务于「外部 MCP host」和「内部 AI 助手」两条路径 —— 这本身就是可抄的设计。

---

## 1. 证据链

三层证据互相独立，结论只建立在三者交集上。

| # | 证据 | 取法 | 锚点 |
|---|---|---|---|
| A | **本地运行态**（发货版 v0.20.2） | 目录／配置／日志／端口／已装桥 | `MAGDA.exe` SHA-256 `75C6439B352DE0DD699D1A5C455BF5F393035F566C006E0F3362CEE9E6D21908` |
| B | **上游源码快照** | `codeload` 归档（非 git clone），3227 个文件 / 81.0 MB | zip SHA-256 `402C924FD4A710496BBC70502238EA645CCFDEA72C131E6F1486C7B9C1B06CDE` |
| C | **机械交叉核对** | 把 B 解析出的 158 个操作名逐个拿到 A 的字符串表里比对 | **158/158 逐字命中，0 缺失** |

补充锚点：
- stdio 桥 `C:\ProgramData\MAGDA\bin\magda-mcp.exe`（420,712 B）SHA-256 `BCC8C5C4724D9C901D5706CE6880194EE326DEDF7556140E0B50D46A9165F2DC`
- 上游 `main` 在核对时刻的 HEAD：`d637460b8a7e29d73a51aabfe980a787b98b47fa`
- **快照新鲜度核对**：从 `raw.githubusercontent.com/.../main/` 取回 5 个文件与本地快照逐字节比对，
  **5/5 相同**（`remote_api.cpp` · `remote_mcp.cpp` · `remote_api.hpp` · `agent_tool_bridge.cpp` · `docs/remote-api-mcp.md`）。
  含最核心的两个实现文件与关键文档 ⇒ 快照与核对时刻的 `main` 在这 5 个点上一致。

**为什么 C 这一层值钱**：它把「我解析源码得到的清单」和「用户机器上真正跑的那个 exe」绑在一起。
任一侧出错（解析漏项、或发货版与源码不一致）都会在这里暴露。实测是 158/158，说明
**发货版 v0.20.2 的注册表至少包含这 158 个操作**；反向检查（在发货版里找源码没有的
`<域>.<动词>` 形式操作名）**没有发现任何多余的**，故 158 很可能就是发货版的确切数。

---

## 2. 第一层：MCP 表面（外部 AI host 能调用的）

### 2.1 连接与发现

| 项 | 值 | 依据 |
|---|---|---|
| 端点 | `http://127.0.0.1:<mcpPort>/mcp`（Streamable HTTP） | `docs/remote-api-mcp.md:21` |
| 绑定 | **仅回环**，默认**关闭**，需在 Settings → Connections → MCP 打开 | 同上 :16 |
| 发现记录 | `remote-api-<pid>.json`（与其它 app data 同目录），含 `port/url/token/mcpPort/mcpUrl/mcpToken/pid` | 同上 :17-24 |
| 鉴权 | 每进程 bearer token，**每次启动重新生成**、退出即删、不落 config | `docs/architecture/remote-api-permissions.md` |
| 浏览器 Origin | 默认全拒（防 DNS rebinding），非空 `allowedOrigins` 才放行 | 同上 |
| 协议版本 | `2026-07-28`（现代／无状态）· `2025-11-25` · `2025-06-18`（旧式／有会话） | `remote_mcp.cpp:220` |

本地实测（A 层）：`config.json` 里 `remoteApi.enabled=false, mcp=false, port=0, mcpPort=0`，
进程无任何监听端口，`AppData\Roaming\MAGDA` 下无 `remote-api-*.json`。
**即：默认状态下 MAGDA 一扇门都不开**，这与文档「off until switched on」一致。

### 2.2 工具命名与投影规则（可直接抄）

- **命名**：`<domain>.<verb>`，如 `tracks.list`、`transport.seek`、`clips.addMidiNote`。
  点号在 MCP 工具名里合法，所以**没有翻译表**：一个名字在 WebSocket 日志、审计记录、
  MCP 工具调用里是同一个（`docs/remote-api-mcp.md:263-266`）。
- **投影**：工具 = 注册表操作，`name` ← 操作名，`description` ← 操作摘要，
  `inputSchema`/`outputSchema` ← 注册表 schema **原样**（`remote_mcp.cpp:290-327`）。
  加一个操作就自动多一个工具，MCP 侧零改动（同文档 :438）。
- **annotations 只放「能推导出来的事实」**：`readOnlyHint` ← 访问级；
  `openWorldHint: false`（不触及项目之外）。
  **刻意不填 `destructiveHint` / `idempotentHint`** —— 理由是「逐操作猜一个，
  而规范本身就要求客户端不要轻信 annotations，猜的那个等于白花这份信任」（`remote_mcp.cpp:318-324`）。
- **不填 `title`**、不做分组／分页／游标（文档与源码双向确认）。
- **数组返回值要包一层**：MCP 把 `structuredContent` 定型为 **object**，
  所以 `tracks.list` 这类数组型操作在工具面返回 `{"items":[...]}`，
  且 `outputSchema` 用同样的包装描述，保证「声明的形状 == 实际返回的形状」；
  而 `resources/read` 没有 `outputSchema` 可满足，就返回**裸数组**。
  WebSocket 传输同样返回裸数组 —— **包装是 MCP 的约束，不是契约的**（`:302-315`、文档 :341-347）。
- **缓存指令照写但归零**：`tools/list`、`resources/list`、`resources/templates/list`、
  `resources/read`、`server/discover` 属「可缓存结果」，一律 `ttlMs: 0` + `cacheScope: "private"`；
  `tools/call` 不可缓存，故**不带**这两个字段（`:166-189`）。
- **工具顺序固定**（按注册表顺序），理由是让客户端可缓存、让模型的 prompt 前缀稳定（`:287-290`）。

### 2.3 26 个域 · 154 个工具

> 完整逐条清单见同目录 **[`magda-tool-registry.tsv`](magda-tool-registry.tsv)**
> （`tool_name / domain / access / required_scope / input_params / output_fields / summary`）。

| 域 | 数 | 域 | 数 | 域 | 数 |
|---|---:|---|---:|---|---:|
| `session` | 19 | `devices` | 12 | `tracks` | 11 |
| `clips` | 19 | `project` | 9 | `pads` | 7 |
| `automation` | 15 | `transport` | 7 | `chordTrack` | 6 |
| `mods` | 6 | `engine` | 5 | `macros` | 4 |
| `racks` | 4 | `sends` | 4 | `chains` | 3 |
| `focused` | 3 | `jobs` | 3 | `midi` | 3 |
| `routing` | 3 | `sidechains` | 3 | `grooves` | 2 |
| `selection` | 2 | `devicePresets` | 1 | `meters` | 1 |
| `system` | 1 | `trackPresets` | 1 | | |

域的划分看得出是**按「用户会后悔什么」**切的，不是按代码里的 manager 切的：

- `session.*`（19）把「场景／槽位／录制」独立成域，与 `clips.*`（19，编排视图的片段）分开；
- `mods.*`（6）/`macros.*`（4）只服务「设备参数调制」，与 `devices.*`（12）分开；
- `pads.*`（7）专给鼓机 64 槽 —— 同一批操作在别处长得像 `devices.*`，这里单独成域；
- `engine.*`（5）里 `engine.masterCapture.start/.stop/.status` 是**一个动作被拆成三个工具**，
  因为捕获是异步且有生命周期（与 `jobs.*` 同一套契约）。

### 2.4 12 个 `magda://` 资源

资源都是「某个**读操作** + 一个 URI」（`remote_mcp.cpp:329-360`）：

| URI | 背后操作 | 可订阅主题 |
|---|---|---|
| `magda://project/current` | `project.get` | project |
| `magda://tracks` | `tracks.list` | tracks |
| `magda://selection` | `selection.get` | selection |
| `magda://transport` | `transport.get` | transport |
| `magda://session` | `session.get` | session |
| `magda://jobs` | `jobs.list` | jobs |
| `magda://devices` | `devices.list` | devices |
| `magda://devices/catalog` | `devices.catalog` | **无**（目录只在重扫插件时变，没人发布这个事件 ⇒ 拒绝订阅） |
| `magda://tracks/{track_id}` | `tracks.get`（`-2` = 主控轨） | tracks |
| `magda://tracks/{track_id}/clips` | `clips.list` | clips |
| `magda://tracks/{track_id}/devices` | `devices.list` | devices |
| `magda://clips/{clip_id}` | `clips.get` | clips |

设计要点：**「资源 = 同一份状态的只读投影」**，指示语里明说
「读很便宜；只要你只需要当前状态，优先读资源而不是调工具」。

### 2.5 写安全（这一节是最值得抄的部分）

| 机制 | 载体 | 作用 |
|---|---|---|
| `expectedRevision` | MCP 放在请求 `_meta`，键 `com.conceptualmachines.magda/expectedRevision`；WS 放在顶层 `meta` | 乐观并发：项目已变则拒绝该写。每次结果里回带 `…/revision`，**客户端无需二次往返就能拿到下次写的种子** |
| `requestId`（MCP）／`idempotencyKey`（WS） | 同上 | **可选**幂等键，必须客户端自己保证唯一（建议 UUID）；不给就不缓存 |
| `deadlineMs` | 同上 | 只能**缩短**服务端超时，不能延长；默认 10 s |
| 撤销粒度 | 服务层 `ScopedUndoStep` 包住每个写 handler | **一次变更 = 一步撤销**；「重复写入相同值」是 revision 不变的 no-op |
| 错误分道 | `tools/call` 用 `isError:true` + 文本信封；协议级失败用 JSON-RPC error | 模型能自救的错（越界、id 不存在、revision 过期）走前者，**不会被 host 当成协议故障吞掉** |

其中幂等键的取舍说得很直白：**不用 JSON-RPC 的 `id` 当幂等键**，
因为 WS 侧按连接隔离而 MCP 侧没有连接概念，两个都从 1 开始计数的客户端会**互相拿到对方的缓存写结果 ——
「一个静默的错误答案，比不缓存更糟」**（`docs/remote-api-mcp.md:402-408`）。

### 2.6 5 个权限域

| scope | 覆盖 | 数量 |
|---|---|---:|
| `read` | 一切读 + 订阅；**「每个客户端都有，这就是被准入的含义」** | 38 |
| `edit` | 项目内容与生命周期（含 new/open/close/save/SaveAs、渲染与捕获、速度、轨、路由、发送、片段、音符、设备、机架、槽、自动化、选择、打开插件窗） | 96 |
| `transport` | 播放／停止／录音准备／循环／定位 | 6 |
| `session` | 场景与 Session 片段的启动／停止／回到编排 | 11 |
| `hardware-midi` | `midi.send`、`midi.sendSysEx` | 2 |
| （非 scope） | `jobs.cancel` —— 先查**作业归属**，再查作业被受理时捕获的 scope | 1 |

两个可抄的细节：
1. **权限检查在 schema 校验之前**。理由是「一个会随载荷是否良构而变化的拒绝，
   本身就是 schema 的预言机」（`remote-api-permissions.md:198-205`）。
2. **授权表是一张连续的 `kWriteScopes[]` 表**，不是每个 `add()` 上挂一个参数；
   因为评审时真正要回答的问题是「**整个 API 到 scope 的划分**是不是我们想要的那个」，
   这只有把策略连着读才能回答。读操作**故意缺席**（默认就是 `read`），
   而一个漏登记的写操作会变成**启动失败**而不是「客户端发现自己能编辑」（同文档 :96-108）。

### 2.7 工具 schema 的形态（154 个工具的机械统计）

- 25 个工具是**零参数**（`emptyObjectSchema()`）—— 全是读操作。
- 117 个工具有字面 JSON schema，其中 **116 个在根上封闭**（`additionalProperties:false`）；
  **5 个用顶层 `oneOf` 判别联合**：`racks.create` · `racks.remove` · `racks.setBypassed` ·
  `transport.seekRelative`（这 4 个根上**同时**封闭，分支 2 条）＋ `session.deleteScene`
  （唯一一个不封闭的，分支 3 条，即「删除场景时对已占用槽位的三种策略」）。
  ⇒ 「多形态参数」在 MAGDA 里是用**判别联合**表达，而不是加一个 `mode` 枚举参数。
- 顶层参数个数分布：`1 个 → 39`、`2 个 → 29`、`3 个 → 20`、`4 个 → 9`、`5 个 → 7`、
  `6 个 → 4`、`8 个 → 3`、`9 个 → 2`、`11/13/14/16 各 1`。
- 参数最多的三个：`mods.create`(16)、`mods.update`(14)、`engine.renderRange`(13)。
  13-16 个参数的工具是**刻意的例外**（调制器创建、离线渲染），其余绝大多数 ≤5。
- **写操作普遍是「1 个必填 id + 一堆可选字段」**（`tracks.update` 9 参只 1 必填、
  `clips.updateAudio` 9 参只 1 必填）—— 即「补丁式更新」，且整条补丁算一步撤销。

---

## 3. 第二层：应用内 AI（16 个 agent）

### 3.1 关键结构：两条执行路径，只有一条共用注册表

| 路径 | 谁 | 怎么落地 | 是否过注册表／权限／撤销 |
|---|---|---|---|
| **(a) 工具循环** | AI Chat 控制台 | `agent_tool_bridge` → `service_.dispatch` → **同一个 `OperationRegistry`** | ✅ 同一套 schema、scope、`expectedRevision`、一步撤销 |
| **(b) DSL／JSON 直连** | 16 个专用 agent（编曲、和弦、鼓、自动化、音色…） | 生成 DSL 或 JSON → `InstructionExecutor` / `applyXxx` **直接改 DAW 模型** | ❌ 不走注册表（不走 MCP 的校验与 scope 判定） |

(a) 的证据：`agent_tool_bridge.cpp:12-48` —— 工具定义**逐个从注册表取**
（`OperationRegistry::instance().find(name)`），`description` ← 操作摘要，`inputSchema` ← 原样克隆，
`access` → `ToolAccess::Read/Mutation`；transport-scoped 的会被跳过并断言
（理由：进程内 agent 没有连接，订阅类动词给它等于给了一个**永远执行不了的工具**）。
scope 也是**从白名单里每个操作推导出来的**（`:50-57`），身份记作 `clientId = "agent:<surface>"`。

(b) 的证据：`command_agent` 生成 MAGDA DSL → `dsl::Interpreter` → `InstructionExecutor` →
`api_.undo()`；`music_agent` 生成 `notes.add_chord(...)` DSL；`drummer_agent` 生成网格文本；
`automation_agent` 生成 `AUTO sin|line|freeform|clear`；`faust_agent` 生成 `.dsp` 源码
（且要过 `mcpVerified` 才 apply）。这些都不经过注册表。

> **这是本次普查里最容易被忽略的一条**：MAGDA 的 AI 能力不是「一个工具循环」，
> 而是「**一个共用注册表的工具循环** + **一群绕过注册表的专用 agent**」。
> 想做 MCP 工具的人应该注意后半句：那些 DSL agent 干的事（作曲、鼓型、自动化曲线、音色设计）
> **在 154 个 MCP 工具里是没有对应动作的** —— 外部 host 只能用原子操作自己拼。

### 3.2 agent 清单（16 个具体实现）

| agent | 角色 | 输出契约 | 后端 |
|---|---|---|---|
| `CommandAgent` | COMMAND | MAGDA DSL 文本（带 CFG 文法约束） | 本地 ONNX 命令模型 **或** LLM |
| `MusicAgent` | MUSIC | `CHORD/NOTE/ARP` 紧凑行 或 `notes.add_*()` DSL | LLM |
| `DrummerAgent` | MUSIC | JSON `{rows,description}`，网格语法（`.`休息 `x`击 `X`重音） | LLM |
| `AutomationAgent` | COMMAND | `AUTO sin/tri/saw/square/exp/log/line/freeform/clear` 逐行 | LLM |
| `ChordAgent` | CHORD | `progression(...).add_chord(...)` DSL | LLM（可 CFG） |
| `MixAnalysisAgent` | COMMAND | **纯散文，不碰任何设备** | LLM |
| `GainStagingAgent` | COMMAND | JSON `{summary,decisions[{id,gainDb,reason}]}` | LLM |
| `GenericSoundDesignAgent` | MUSIC | JSON `{name,description,params{}}` | LLM |
| `FourOscAgent` | MUSIC | 4OSC 预设 JSON | LLM |
| `PolyStepSequencerAgent` | MUSIC | 步进序列器 pattern JSON | LLM |
| `StepSequencerAgent` | MUSIC | 单音 303 pattern JSON | LLM |
| `FaustAgent` | FAUST | JSON `{name,description,source}`（Faust 程序） | LLM |
| `CoderAgent` | — | 设备源码字符串 | 无自有后端 |
| `ThemeAgent` | THEME | 调用方给的 schema（主题配色） | LLM |
| `ControllerProfileAgent` | CONTROLLER | JSON（控制器档位），带 schema 结构化输出 | LLM |
| `SoundDesignAgent` | MUSIC | 上面三种设备 agent 的门面 | 委托 |

运行时四件：`agent_runtime`、`agent_tool_bridge`、`console_agent_orchestrator`、`device_ai_agent.hpp`。

### 3.3 工具循环的预算（可直接抄的护栏）

`agent_runtime.hpp:57-63`：

```
maxSteps                    = 8
maxTokens                   = 32 000
maxMutations                = 8
maxIdenticalCallsAtRevision = 2      // 同一 revision 下重复同一调用两次就停
maxWallTime                 = 2 min
```

外加三条终止条件：**「一批并行调用里含变更」直接判为不安全**（`UnsafeParallelMutation`）、
**`expectedRevision` 回退**判 `revision_regressed`、**无调用也无文本**判 `InvalidModelResponse`。

一条重要限制：**内置本地模型不能做工具调用**。
`llama_local_client.cpp` 对任何带 `tools` 的请求直接返回
`"Native tool calls are not supported by the embedded LlamaLocal backend"`。
本地 `config.json` 里 `ai.preset = "local_embedded"` 且 `ai.toolLoop = false` —— 二者自洽。

---

## 4. 第三层：其它入口，以及边界

| 入口 | 是什么 | 面向 AI？ |
|---|---|---|
| **stdio 桥 `magda-mcp.exe`** | 已装在 `C:\ProgramData\MAGDA\bin\`。把 MCP host 的 stdio 转成 HTTP，**每次请求重读发现记录**取端口与 token，所以 host 配置里不用写会变的端口／token；无参数、诊断只走 stderr | ✅ 这就是给 AI host 用的推荐接法（`claude mcp add magda -- magda-mcp`） |
| **WebSocket JSON-RPC** `ws://127.0.0.1:<port>/rpc` | 与 MCP **共用**分派器／订阅中心／客户端注册表，但**独立端口、独立开关、独立 token** | 半 —— 脚本／程序用；AI host 走 MCP |
| **OSC** | 独立 UDP 栈：**无 token、无客户端注册表、无 scope**，默认关 | ❌ 明确「不属于这套东西」 |
| **Lua 控制器脚本** | `F:\MAGDA\controllers\scripts\*.lua`（8-knobs / foot-pedal / launchkey / launchpad） | ❌ 是控制器映射，不是 AI 面 |
| **`magda-cli`** | 源码里有 `magda/daw/cli/magda_cli_main.cpp`，用途是工程往返测试 | ❌ 本地未安装 |
| **上游仓自带的 AI 指令文件** | 快照里有 `CLAUDE.md`（458 B，注释密度规则）、`.claude/skills/`（20 个技能目录）、`.cursor/` | ❌ 与运行时接口无关，但**clone 下来就会进 agent 的指令上下文** —— 取源码做分析时值得先意识到这一点 |

> 关于最后一行的一条实测：本任务把源码包解到工作区 `scratch/` 后，DSH **确实自动注入了那份
> `CLAUDE.md`** 的指令（工作区本身明令禁止任何层级出现 `CLAUDE.md`，门禁因此转红）。
> 已删除解包副本（原件在 zip 内同哈希可复原）。**这不是 MAGDA 的问题，是「取源码」这类动作的通用副作用。**

---

## 5. 给「构建 MCP 工具」的参考：可抄 14 条

1. **一张注册表，多路投影**。工具、资源、WebSocket 方法、内部 AI 工具循环全部来自同一张表 ——
   一个名字在日志、审计、工具调用里是同一个人。**不要为 MCP 另建一套动作表。**
2. **命名 `<域>.<动词>`，不做翻译**。点号合法，省掉映射层，也让日志可直接检索。
3. **一个动作一个工具，不做「万能命令」**。他们**明确否决了 `batch.execute`**
   （`docs/architecture/remote-api-batch-decision.md`），理由：通用 batch 并**不能**让
   载入工程／录音／渲染／实例化设备变得原子，因为那些操作有撤销栈回滚不了的引擎或文件系统副作用。
4. **annotations 只放可推导的事实**。`readOnlyHint` 由访问级推出，`openWorldHint:false`；
   `destructiveHint`/`idempotentHint` **宁可不填** ——「猜一个等于白花客户端对 annotations 的信任」。
5. **`title` 可以不要**，但 `description` 必须是人话摘要（154 个都有）。
6. **schema 封闭**（`additionalProperties:false`），未知字段直接拒；数字要求有限、有界。
7. **数组返回值必须包装**成对象以符合 MCP 的 `structuredContent` 定型，
   且**用 `outputSchema` 声明同一个包装**，让「声明 == 实际」。
8. **写要有乐观并发**：一个 revision、放在 `_meta`（厂商前缀键）、结果回带新 revision。
9. **幂等键可选且必须由客户端提供**；**绝不**用传输层的请求 id 当幂等键。
10. **一次变更 = 一步撤销**，并且「重复写同样的值」是 revision 不变的 no-op。
11. **权限按「用户会后悔什么」分域**，不是按内部 manager 分；**检查要在 schema 校验之前**，
    拒绝时**说出缺哪个 scope**（而不是假装操作不存在）。
12. **默认只读**，客户端首次连接只能读；授权按**归一化后的客户端名**记住（`Cursor`/`cursor `/`cursor` 视为同一个）。
13. **长任务走统一 job 契约**：不透明 `job_…` id ＋ 受理时的 revision；
   终态恰好一个（`completed|cancelled|failed|unsupported`）；**取消立即终态**，
    迟到的 worker 不能再用成功覆盖它；产物用不透明的 `artifact_…` 句柄，**绝不返回文件系统路径**。
14. **可缓存结果照写缓存指令但归零**（`ttlMs:0` + `cacheScope:"private"`），
    理由诚实：这是用户在编辑的实时会话，缓存下来就是可能错的答案。

### 反面清单（他们想过并否掉的）

- ❌ 通用 `batch.execute`（见上，附**重新开启的条件清单**）。
- ❌ 用 JSON-RPC `id` 当幂等键（会串号）。
- ❌ `destructiveHint` / `idempotentHint` 猜着填。
- ❌ 用「续传游标」做订阅恢复：revision 只统计提交过的变更，而事件还包含不提交的连续运动
  ⇒ 「漏掉一个的客户端」和「看到了的客户端」**revision 相同、无法区分** ⇒ 只做**全量快照 + resync**。
- ❌ `Last-Event-ID` 重放（通知只带 URI，没有可重放的内容）。
- ❌ 把 `meters`/`playhead` 做成资源：「20 Hz 的 `resources/updated` 对 host 是滥用，
  而一个不带值的 URI 通知对电平表毫无用处」—— 它们只走 WebSocket。
- ❌ 每次请求都做权限缓存：授权**逐请求查**，撤销才立即生效。
- ❌ 审计写盘：审计日志**只在内存**，不记录输入、结果、错误**消息**、token、路径。

### 一条特别好用的工程习惯

`tools/transport_check/` 是一个**照着 `docs/remote-api-mcp.md` 独立写出来的**验证客户端，
与应用**不共享任何代码** —— 于是「文档与实现不一致」本身会让检查变红。
再加一个**官方 SDK** 套件（「rejects shapes a hand-written client accepts」），
以及一个**突变测试**：一次只把桩弄坏一处，断言对应的检查变红；
他们的规矩是「往 `suites.py` 加一条检查，就往突变测试里加对应的那一刀；
如果去掉它没有任何东西变红，那你加的那行只会永远打印 OK」。
判定有四种，含显式的 `?`（不可判）—— **不让不可判的检查冒充 FAIL，也不因此训练读者忽略红色**。

---

## 6. 不能证明什么（重要）

1. **没有做运行态探测**（用户裁定：不改动正在运行的 MAGDA）。
   154 这个数字是「源码注册表 × 投影规则」算出来的，并用发货版做逐字命中核对；
   **没有人真的对着运行中的端点调过一次 `tools/list`**。
2. 因此「发货版 v0.20.2 的注册表**恰好**是 158 个」是**推断**而非实测：
   已证「≥158」（158/158 命中），反向扫描未发现多余的 MCP 形操作名，但反向扫描不是证明。
3. 源码快照按 zip 的 SHA-256 锚定；已抽 5 个文件（含 `remote_api.cpp`、`remote_mcp.cpp`）
   与核对时刻的上游 `main` 逐字节比对**全部相同**，但**未做全树 3227 个文件的逐一比对**，
   故「快照 == `d637460…` 整棵树」是推断。
4. 用户机器上的 `F:\MAGDA` 是 v0.20.2，而源码是上游 `main`；
   两者若在某处漂移，本文的「文件:行号」引用指向的是**源码**，不是 exe 的反编译。
5. `agent_tool_bridge` 与 `remote_service` 的协作细节来自源码阅读；
   路径 (b) 的那些 agent **是否全部**绕过了校验／scope／审计，未逐调用点穷尽核对。
6. 未评估**安全影响**：远程 API 的威胁模型文档自己声明「它**不是**沙箱，
   也不是对本机恶意进程的防御」—— 能读你家目录的进程本来就能读到 token。
7. 未做：MCP 端点的实机 `tools/list` / `resources/list` 抓取；未验证 `magda-mcp.exe` 的转发行为。

---

## 7. 复现命令

```powershell
# 1. 证据锚点
Get-FileHash F:\MAGDA\MAGDA.exe -Algorithm SHA256
Get-FileHash "C:\ProgramData\MAGDA\bin\magda-mcp.exe" -Algorithm SHA256
Get-Content -Raw "$env:APPDATA\MAGDA\config.json"          # remoteApi / ai 两节

# 2. 取源码快照（绕开已死的 7892 代理；17892 可用）
curl.exe -s -L -o magda-core-main.zip `
  https://codeload.github.com/Conceptual-Machines/magda-core/zip/refs/heads/main

# 3. 机械枚举注册表（脚本在任务槽 scratch/）
python ops_census2.py <src>\magda\daw\api\remote_api.cpp            # 158 操作 / 154 工具
python scope_policy.py <src>\magda\daw\api\remote_api.cpp ops.json  # 权限表 115 行
python crosscheck_binary.py ops_registry_v3.json MAGDA.exe.strings.txt  # 158/158 命中
python ops_rejects.py  <src>\magda\daw\api\remote_api.cpp           # 尺子自查：未匹配的 add 调用点
```

---

## 8. 留痕（§5.6）

| 通道 | 原文 | 结果 |
|---|---|---|
| `web_search` | `magda-core Conceptual Machines MCP server DAW` 等 3 条 | **未答**：端点 `https://api.anysearch.com/v1/search/messages` 返回 HTTP 404，搜索通道不可用 |
| `web_fetch` / `git ls-remote` | `https://github.com/Conceptual-Machines/magda-core` | ✅ 直连可用（`-c http.proxy= -c https.proxy=`）；全局 `http.proxy` 指向 **7892 已死**，17892 在听 |
| `curl codeload` | `https://codeload.github.com/Conceptual-Machines/magda-core/zip/refs/heads/main` | ✅ 200，30,840,405 B |
| GitHub REST API | `/repos/.../git/trees/main?recursive=1` | ❌ 403 rate limit exceeded |
| `git clone --depth 1` | 同一 URL | ❌ **0.03 MB / 10 分钟后仍无 index**（挂死）⇒ 改用 codeload 归档 |

> 结论性提醒：**「clone 挂死」≠「仓库不可达」**——同一时刻 codeload 与 `ls-remote` 都是通的。

---

## 9. 方法学自纠（三条，都指向同一件事：先怀疑尺子）

1. **v1 解析器漏了 21 个操作**。它用 `^add("name","summary",…)` 单行正则，
   于是**包装器** `addPadOperation(...)`（7 个 pads 操作）与 `addModulationOperation(...)`
   （6 个 mods ＋ 4 个 macros）**整类丢失**，总数从 158 误报成 135。
   ⇒ 是**对抗性自查脚本**（`ops_rejects.py`：把所有未被匹配的 `add(` 调用点打出来）抓到的。
2. **v2 又漏 2 个**：`devices.setParameterConfig` 与 `grooves.upsert` 的摘要由**相邻字符串字面量拼接**，
   被「第二个参数必须是单个字符串」的判据拒掉。⇒ 改成按**实参位置**取 schema，并接受字面量拼接。
3. **schema 归属错配**：一度按「字节距离最近的注册」配 schema，导致 `session.deleteScene` 被报成
   「0 参数」—— 实际它用顶层 `oneOf` 表达三个分支。
   ⇒ 改为把注册调用的实参一次性切开、按位置取第 5/6 个实参。
4. **修完 3 之后又写错一次**：报告初稿写「只有 1 个工具用顶层 `oneOf`」，
   而按实参位置重算后实际是 **5 个**（4 个同时根上封闭）。
   ⇒ 原因是**把「那个唯一不封闭的」当成了「那个唯一用 oneOf 的」** ——
   同一个 `session.deleteScene` 在两个不同判据下都是「异类」，于是被误当一个类别。
   **教训**：一个样本在两个维度上都是例外时，最容易把「两个维度的例外」读成「一个例外」。

**教训（与工作区在册判据同族）**：一个数不出来或数错的地方，
**要先问「我的尺子在这类输入上会怎样」，而不是先给结论**；能抓出这类错的，
往往是一个**专门去找「我没匹配上什么」的反向脚本**，而不是再读一遍正向逻辑。
