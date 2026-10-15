# 调研归档与来源

归档日期：2026-10-15。用户提供的 MAGDA-AI-INTERFACE-SURVEY.md 和 magda-tool-registry.tsv 按原字节复制，原目录未修改。原路径、文件 SHA-256、安装器及源码包校验值记录在 provenance.json。安装器和源码压缩包仅保留在本地 .resource，不进入 Git、npm 包或 Release。

调研源码快照为 Conceptual-Machines/magda-core 的 d637460b8a7e29d73a51aabfe980a787b98b47fa；MAGDA v0.20.2 标签指向 2917d82cacf4145d57550f96d8829fa25bf6dbf7。快照较标签晚两次提交；已核对远程 API/MCP/bridge 相关内容无变化。源码文件引用应标明提交、仓库内路径和用途，不使用浮动 main 作为版本证据。

原始调研以源码、安装目录和二进制字符串交叉核对为主，未进行原生运行态业务调用。报告中的“资源 12”是 8 个固定资源与 4 个资源模板的合计；MCP 的两个目录应分别记录。

本项目随后在 MAGDA 0.20.2 实机采集完整目录及 system.describe，确认 154 个工具、8 个资源、4 个模板；工具名与 TSV 全量一致。契约及采集时间、程序 SHA-256 记录在 contracts/magda/0.20.2/manifest.json。完整 Schema 的依据是该次运行态采集，TSV 仅用于名称交叉核对。

上游源码：Conceptual-Machines/magda-core，关键路径为 docs/remote-api-mcp.md、magda/daw/api/remote_api.cpp、remote_mcp.cpp、remote_mcp_server.cpp、remote_clients.cpp。上游仓库入口为 https://github.com/Conceptual-Machines/magda-core 。本项目未把源码归档提交到 Git。
