# 架构与设计决策

## 数据流

~~~mermaid
flowchart LR
  H[MCP 宿主] -->|stdio / SDK| S[协议入口与原生目录]
  S --> L[本地 status / reconnect]
  S --> G[Gateway：实例绑定与兼容性]
  G --> D[发现记录与 Windows 进程版本]
  G -->|Streamable HTTP / SDK| M[MAGDA 0.20.2]
~~~

单 npm 包、TypeScript ESM、Node.js 24+。cli 负责参数和生命周期，discovery 负责数据目录与记录，platform/windows 读取可执行文件版本与进程创建时间，connection 管理固定实例，proxy 使用 SDK 底层请求接口保留 Schema，management 只包含两个管理工具。

不为各音乐业务编写单独适配器。运行时目录来自 MAGDA；离线目录来自已实机验证并核对 SHA-256 的 catalog.json。完整目录指纹对工具、资源、模板排序后计算；对象字段排序，Schema 内的数组顺序保留。变更能力取决于应用版本、API 版本及完整指纹一致。

## 连接状态

初始 offline。唯一候选或指定 PID 进入 connecting，成功后为 connected；版本或契约异常进入 incompatible。incompatible 允许 readOnlyHint=true 的原生读取，其他原生调用在发送前阻止。管理工具始终可用。

每次原生请求和诊断前重新读取发现记录并检查进程存在。相同 PID 的 token 或端点变化触发重建连接、恢复订阅及 URI 失效通知。已绑定记录消失或检测到进程创建时间变化会锁定 disconnected；只有显式 reconnect 清除该锁定。重连开始前检查在途原生请求与连接准备状态。

发现记录只允许数字 PID、匹配文件名、有效端口、有限大小、非空凭据和两个字面回环地址，禁止重定向。凭据只在内存中保存；状态和错误不输出凭据。Windows 进程检查使用固定 PowerShell 程序，数字 PID 通过子进程环境传入。

## 协议与元数据

server/client/core 锁定官方 SDK 2.3.1。上下游各自协商 2026-07-28、2025-11-25、2025-06-18；SDK 构造各自的传输信封、能力字段与请求取消消息。业务 _meta 保留；io.modelcontextprotocol/* 和 progressToken 不跨连接原样复制。进度通知通过下游请求上下文转发。

2025 协议使用 resources/subscribe 和 resources/unsubscribe；2026 协议使用 subscriptions/listen。入口 transport 观察现代过滤器，在向 SDK 交付前建立上游资源订阅，并把确认过滤器限制为上游实际接受的 URI。帧处理、协议选择、通知路由、取消和 stdio 生命周期由 SDK 负责。Gateway 合并各订阅的 URI 集合；现代上游使用一个 listen，旧版上游按 URI 订阅。

原生 content、structuredContent、isError、annotations 和业务元数据原样保留；SDK 的结果投影处理不同协议的可表示性。数组结果采用 MAGDA 自身的 items 等对象包装。接口参数校验和业务授权由 MAGDA 完成；本地管理工具单独校验参数。

MAGDA 有时用 HTTP 429/400 等返回相关 JSON-RPC 错误。仅在响应满足官方错误 Schema 且 ID 与请求一致时，将 HTTP 信封交给 SDK 的 JSON-RPC 层处理；401 身份挑战和不可关联错误保持原 HTTP 行为。不会因此重发请求。

## 请求结果与恢复

变更是否只读依据原生 annotations.readOnlyHint；未知操作按变更处理，最终未知工具错误仍由 MAGDA 返回。发送后失去确认响应的变更返回 OUTCOME_UNKNOWN。SDK 网络重连与 scope 自动重试被关闭，不主动重放原生业务请求。

取消等待的请求与取消后台作业相互独立。MAGDA 负责 revision、幂等键、权限和作业状态。资源通知是失效提示，无重放和持久事件序号承诺；恢复后提示客户端重读。

## 边界

正式支持 Windows x64 和 MAGDA 0.20.2。仅代理 MAGDA 已有接口，不实现编曲工作流、自动授权、插件安装或跨版本 Schema 修补。完整工具转发测试通过模拟原生响应验证传输保真；代表性实机流程验证实际业务调用，两者分别记录。
