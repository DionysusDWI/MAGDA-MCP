# 排障与错误语义

先运行 magda-mcp-server doctor --json 和 instances --json。请勿向日志、工单或公开截图附上 remote-api-<pid>.json；其中包含凭据。

| 状态 / 错误 | 处理 |
|---|---|
| NO_INSTANCE / offline | 启动 MAGDA、打开 MCP；核对 --data-dir 与应用实际数据目录 |
| AMBIGUOUS_INSTANCE | 从候选 PID 中选择 --pid，或调用 reconnect 并指定 pid |
| INVALID_CONFIG | 修复配置或明确指定数据目录 |
| STALE_RECORD / INVALID_RECORD | 检查应用是否退出、记录是否损坏；代理不会接受任意主机或重定向 |
| INSTANCE_EXITED / disconnected | 核对 MAGDA 运行状态，再显式 reconnect；不会自动切换实例 |
| UNSUPPORTED_VERSION | 使用可确认的 MAGDA 0.20.2 可执行文件；版本未知时原生变更被阻止 |
| CONTRACT_MISMATCH | 核对应用版本与接口快照；不要通过修改快照绕过检查 |
| BUSY | 等原生请求结束后重连 |
| CONNECTION_FAILED | 检查 MCP 监听器与 MAGDA 状态；端点或凭据变化后对同一进程可恢复 |
| OUTCOME_UNKNOWN | 先读回项目状态或查询作业，确认前不要重试变更 |
| 原生 permission_denied | 在 MAGDA Clients 中给对应宿主授权；doctor 不能验证写权限 |
| 原生 Rate limit exceeded | 降低请求速率；被拒绝的调用需由宿主决定是否重新提交 |

代理返回的本地工具执行错误使用 isError=true，其文本 content 含 {"error":{"code":...}}。原生工具业务错误保留 isError、content 和业务 _meta；原生 JSON-RPC 错误保留 code/message/data，包括 MAGDA 使用非 2xx HTTP 状态返回的相关错误。

OUTCOME_UNKNOWN 只说明无法取得确认响应，不能推出变更失败。HTTP 请求断开、等待超时或客户端取消，都不会自动执行 jobs.cancel。后台作业仍通过 jobs.get / jobs.list 查询，并通过 jobs.cancel 取消。

资源更新是 URI 失效通知，不含事件重放。收到更新或订阅恢复通知后重新读取资源。不要依据断线期间未收到通知推断项目未变化。

v0.1.0 仅连接 http://127.0.0.1:<端口>/mcp 或 http://[::1]:<端口>/mcp。localhost、其他 127.x 地址、域名、用户信息、额外路径、查询串和 HTTP 重定向均不接受。
