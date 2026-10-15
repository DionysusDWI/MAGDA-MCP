# Changelog

## 0.1.0 — 2026-10-15

- 新增 Windows x64 / Node.js 24+ / MAGDA 0.20.2 支持。
- 通过 stdio 代理 154 个原生工具、8 个资源和 4 个资源模板，增加 status 与 reconnect 管理工具。
- 新增数据目录解析、实例发现、应用版本和完整接口契约检查、固定 PID 连接及凭据更新。
- 适配三种协议版本与两代资源订阅机制，保留业务元数据和 JSON-RPC 错误。
- 变更结果未知时返回 OUTCOME_UNKNOWN；不自动重放请求。
- 提供协议矩阵、连接故障、Windows 实机工作流和仓库外 tarball 安装验收。
- 首次发布安装 tarball、SHA-256 校验值、兼容性说明及验收记录。
