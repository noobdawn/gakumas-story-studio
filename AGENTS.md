# GSS 开发约束

先读 README.md 与 docs/developer。运行资源只取当前有效受管理批次，游戏目录只读，不恢复历史样本回退。用户作品与配置不得作为测试夹具或公开预设。

不向占用中的 Unity 工程写入或构建；构建使用新的输出目录。默认只进行无头检查，实际可见界面由用户验收。编译、GPU 离屏与可见预览结论分别记录。

资源来源在 THIRD_PARTY_NOTICES.md 和 resources 清单维护。项目许可证目前待定，不擅自开启 release-policy.json。不要提交 runtime、dist、Library、node_modules、用户数据或密钥。

本机只维持 `build/` 一份可测试版本，用户只测试 build。用 scripts/checkpoint.py 保存源码回退点，最多保留 3 个 dev/* 分支；不为分支复制工程、依赖或资源。scripts/update-build.ps1 在临时目录完成检查、构建与组包，验证后替换 build，失败保留旧 build，最后清除临时构建。常规开发不保留发布 ZIP。历史 Git 提交共享对象，无须为了只留 3 个分支而重写主分支历史。
