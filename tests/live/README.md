# Windows 实机验收

实机入口为 scripts/live-test.ts，通过 npm run test:live -- <隔离dataDir> 运行。该入口使用官方 SDK 启动生产 stdio 子进程，并在写入前验证隔离数据目录与空白工程。测试过程和权限变化的边界见 docs/development/testing.md；可公开的验收结果归档到 docs/releases。
