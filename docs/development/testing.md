# 开发、测试与发布

## 可复现构建

~~~powershell
npm ci
npm run check
npm run check:package
~~~

check 依次执行源码与脚本/测试类型检查、ESLint、TypeScript 构建、Vitest；测试前构建保证干净检出时也能启动生产 CLI。测试 mock 的进程检查替身仅存在于 tests/fixtures/gateway-child.ts；生产 CLI 没有跳过版本检查的开关。

协议矩阵为三种下游 × 三种上游，共九种组合。每种组合用官方 SDK 启动实际 stdio 子进程，核对全量工具与 Schema、业务参数、结果和元数据，并验证资源读取及订阅通知。模拟业务响应只证明转发保真，不证明 154 个工具都执行过实机业务。

连接测试覆盖凭据轮换、实例退出锁定、显式重连、版本/契约异常、BUSY、超时与取消后的结果未知、无重放、业务/JSON-RPC/HTTP 拒绝错误及订阅恢复。发现测试覆盖目录优先级、多个实例、残留和损坏记录、MCP 关闭和非法地址。

## Windows 实机

关闭其他 MAGDA 后，通过 launch-live.ps1 创建隔离配置。脚本拒绝在已有 MAGDA 时另启实例，避免 MAGDA 的单实例机制把测试请求导向用户工程。

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-live.ps1 -Executable C:\MAGDA\MAGDA.exe -Permissions edit
npm run build
npm run capture:contract -- <脚本输出的dataDir>
npm run test:live -- <脚本输出的dataDir>
npm run check:package -- --live-data-dir <脚本输出的dataDir>
~~~

launch-live 使用子进程专用 MAGDA_CONFIG_FILE、MAGDA_DATA_DIR 等变量；所有设置、发现记录、工程和渲染都位于 artifacts/live。隔离配置明确使用 magda 音频引擎并关闭首次引擎选择提示，避免隐藏对话框阻塞启动。仅 MAGDA-MCP/live-acceptance 获得 edit/transport/session。实机脚本在写入前检查隔离目录、未保存且干净的工程、空轨道；完成后停止播放并关闭自有工程。守卫失败时先检查工程，不能放宽守卫自动覆盖。

实机报告输出 artifacts/live/acceptance.json。只读/撤权检查可在隔离实例权限改为 read 后运行 npm run test:live -- <dataDir> --readonly；报告会注明权限变更的激活方式。若在 GUI 中撤权，须另外记录同一进程、同一客户端后续请求的观测结果，不能把重启后生效写成即时撤权验证。

## 包验收与发布

check:package 构建并打包，检查 npm 文件白名单、解包文本中的本机路径和已知测试 token；随后在仓库外新临时目录安装 tarball。用官方 SDK 调用安装后的入口，检查离线目录、诊断、参数退出码、config 绝对路径和 stdout，传入 --live-data-dir 时再检查真实连接。临时安装目录按固定前缀与父目录校验后删除。

输出位于 artifacts/release：tarball、SHA256SUMS、package-acceptance.json。发布资产还应包含实机验收 JSON、兼容性说明。原始发现记录与配置不能上传。发布前确认 Git 工作区干净，npm run check、check:package 和实机检查全部通过；建立 v0.1.0 标签并创建 GitHub Release。此版本无需 npm registry 发布。

CI 在 Windows 上使用 Node 24执行检查。Release 工作流会重新构建并进行独立 tarball 安装检查，要求仓库中已有通过的实机验收记录；云端构建不能替代 MAGDA 实机验收。

本地安装报告归档为 docs/releases/package-acceptance-0.1.0.json，该文件不进入 tarball，避免校验值自引用。CI 会核对重建 tarball 与实机安装通过的文件是否具有相同 SHA-256，只有一致才允许发布。
