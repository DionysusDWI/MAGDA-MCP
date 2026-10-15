# 安装、授权与 CLI

## 前提与安装

正式支持 Windows x64、Node.js 24+、MAGDA 0.20.2。先下载 GitHub Release v0.1.0 中的 tarball 和 SHA256SUMS，再用 Get-FileHash 核对 SHA-256，最后运行 npm install --global <tarball路径>。

MAGDA 与 MAGDA-MCP 分别安装。MAGDA 自带的 magda-mcp.exe 不属于本包；本包命令为 magda-mcp-server。

在 MAGDA Settings → Connections → MCP 开启 MCP。WebSocket 无需开启。运行 doctor --json 检查应用版本及契约，然后使用 config 输出的绝对路径配置宿主。服务的 stdout 专用于 MCP，日志写 stderr。

## CLI

| 命令 | 参数与输出 |
|---|---|
| 无命令 / serve | 启动 stdio 服务；支持 --data-dir PATH、--pid N |
| instances --json | 输出候选 PID、回环端点及记录问题，无 token |
| doctor --json | 诊断实例、连接、应用版本、API、协议和契约；退出 0 为就绪，1 为未就绪，2 为参数错误 |
| config | 输出当前 node.exe 和已安装入口的绝对路径；可追加数据目录和 PID |
| --help / --version | 显示用法 / 包版本 |

数据目录优先级：--data-dir → MAGDA_DATA_DIR → MAGDA 配置中的 dataDir → %APPDATA%\MAGDA。MAGDA_CONFIG_FILE 可指定配置文件；否则读取 %APPDATA%\MAGDA\config.json。配置损坏会给出错误，不静默连接到其他目录。

只有一个有效实例时自动选择；多个实例时需 --pid 或 magda_mcp.reconnect 的 pid。启动参数 --pid 是初始偏好；显式重连可以更换实例。绑定后不会因出现新实例而自动切换。

## 授权

宿主身份规范化为 MAGDA-MCP/<宿主名称>，统一小写、去除控制字符并限制长度。MAGDA 可能进一步将显示名称中的分隔符规范化；在 Clients 中按显示名称确认宿主。

MAGDA 管理 read、edit、transport、session、hardware-midi 等 scope。首次客户端默认只读；写入被拒绝时，当前请求不会因随后授权而自动重试。授权只影响后续请求。为当前工作流授予所需权限，再由宿主显式提交新请求。

doctor 使用独立的 MAGDA-MCP/doctor 身份，只读成功不表示业务宿主拥有 edit 或其他权限。改变授权后以原生调用结果为准。权限拒绝属于原生业务错误，代理不会绕过它。

## 管理工具

magda_mcp.status 接受空对象，返回 state、boundPid、candidatePids、applicationVersion、protocolVersion、apiVersion、identity、contract、catalogSource、counts、lastError 等信息。catalogSource=baseline 时目录来自随包的已验证快照，不能据此认为 MAGDA 在线。

magda_mcp.reconnect 接受 {} 或 {"pid":1234}。无 PID 时仅接受唯一候选。有原生请求在途时返回 BUSY，完成后可再调用。实例退出后，即使发现了新的 MAGDA，也必须显式重连。

业务元数据放在 _meta 中，使用 MAGDA 的原键：com.conceptualmachines.magda/expectedRevision、com.conceptualmachines.magda/requestId；结果中的 revision 同样保留。幂等键的生命周期与冲突规则由 MAGDA 定义。
