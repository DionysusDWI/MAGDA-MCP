# MAGDA-MCP

MAGDA-MCP 是面向 **Windows x64 / Node.js 24+ / MAGDA 0.20.2** 的 MCP 网关。它将宿主的 stdio 连接转接到 MAGDA 原生 Streamable HTTP 服务，并提供实例发现、固定实例连接、凭据更新、诊断和兼容性检查。

**v0.1.0：154 个原生工具 + 2 个本地管理工具，8 个固定资源，4 个资源模板。** 工具名称、业务参数和完整 JSON Schema 均来自 MAGDA 实机目录。离线时仍可查询基线目录和本地诊断。

MAGDA-MCP is a Windows MCP gateway for MAGDA 0.20.2. It preserves MAGDA's native tools and resources, adapts supported MCP protocol revisions, and adds instance discovery and connection diagnostics.

## 安装与连接

从本仓库 **GitHub Releases 的 v0.1.0** 下载 tarball 和 SHA256SUMS，核对文件校验值后安装：

~~~powershell
Get-FileHash .\dionysusdwi-magda-mcp-0.1.0.tgz -Algorithm SHA256
npm install --global .\dionysusdwi-magda-mcp-0.1.0.tgz
magda-mcp-server --version
~~~

本版通过 GitHub 发布可安装的 npm tarball；安装命令不依赖 npm registry 上已发布同名包。请先安装 Node.js 24 或更新版本。

1. 启动 MAGDA 0.20.2，在 **Settings → Connections → MCP** 开启 MCP。
2. 运行下列命令确认实例和版本，然后取得启动配置。
3. 将配置片段填入宿主的 MCP 服务配置。首次业务请求后，在 MAGDA 的 Clients 设置中为对应宿主授予所需 scope。

~~~powershell
magda-mcp-server instances --json
magda-mcp-server doctor --json
magda-mcp-server config
~~~

~~~json
{
  "mcpServers": {
    "magda": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\path\\to\\installed\\magda-mcp\\dist\\cli\\index.js", "serve"]
    }
  }
}
~~~

以上路径是示例。使用本机 config 输出的绝对路径；需要选择数据目录或 PID 时，可运行 config --data-dir <目录> --pid <PID>。输出的是单个服务对象，嵌入宿主需要的顶层配置即可。

## 接口与行为

| 接口 | 用途 |
|---|---|
| MAGDA 的 154 个原生工具 | 沿用 MAGDA 的名称、Schema、revision、requestId、scope 和作业语义 |
| magda_mcp.status | 无参数；返回实例、版本、协议、兼容性、工具数量和最近错误；不返回 token |
| magda_mcp.reconnect | 可选正整数 pid；显式选择实例；原生请求执行中返回 BUSY |
| 原生资源与模板 | 列举、读取、订阅更新；恢复订阅后发出 URI 失效通知，客户端应重新读取 |

支持的 MCP 协议版本为 2026-07-28、2025-11-25、2025-06-18，上下游分别协商。默认固定首次选中的 PID；目标退出后需显式重连，不会切换到其他进程。发现记录中的同实例凭据变化可自动恢复连接。

非 0.20.2、应用版本无法识别或完整接口契约不匹配时，保留只读和诊断能力，阻止原生变更。MAGDA 的 MCP serverInfo.version 为 1.0，不能用来判断应用版本。doctor 的成功不代表已经获得写权限。

变更请求失败后不会自动重放。OUTCOME_UNKNOWN 表示结果无法确认，需先检查 MAGDA 中的状态。停止等待或取消 MCP 请求不会取消后台作业；请使用 jobs.cancel。

## 开发与验收

~~~powershell
npm ci
npm run check
npm run check:package
~~~

实机测试必须使用脚本创建的隔离配置和空白临时工程，具体见 [开发与验收](docs/development/testing.md)。依赖锁文件必须提交；生产 server/client/core SDK 统一锁定 2.3.1。

- [安装、授权与 CLI](docs/usage/setup.md)
- [排障与错误语义](docs/usage/troubleshooting.md)
- [架构与设计决策](docs/architecture/design.md)
- [开发计划与后续版本](docs/development/roadmap.md)
- [v0.1.0 兼容性及验收](docs/releases/v0.1.0.md)
- [调研归档与证据来源](docs/research/README.md)

本版验收宿主是官方 MCP SDK 测试客户端。macOS/Linux 实机支持、更多 MAGDA 版本和编曲工作流工具留待后续版本。

## 许可证

网关实现沿用本仓库 MIT LICENSE。MAGDA 接口快照的上游来源和许可证见 [第三方说明](THIRD_PARTY_NOTICES.md) 与 contracts/magda/0.20.2/UPSTREAM-LICENSE。
