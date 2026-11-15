# 参与开发

先阅读 README、docs/developer 与 AGENTS.md。项目仍是发布候选，代码许可证未定；提交变更前请先与维护者讨论范围。

使用 Node.js 22、Python 3.14、Unity 6000.3.24f1。`scripts/bootstrap.ps1` 安装锁定依赖。运行 `python scripts/check.py`、`node --test apps/desktop/electron/tests/*.test.js`，并在 services/host 运行 `python -m unittest discover -v`。完整媒体测试需要 FFmpeg/FFprobe；Windows 密钥保护测试需要正常用户上下文。

测试使用隔离人工夹具。不要上传游戏资源、解包缓存、个人工程、声库、账号数据或密钥。Unity 构建前检查工程占用，使用新输出目录，结束后关闭自己启动的测试进程。

报告问题时说明版本、复现步骤、期望行为和实际行为。附日志前删除个人路径和敏感内容；不要上传完整游戏素材库。区分编译通过、逻辑测试通过、离屏结果与实际界面验收。
