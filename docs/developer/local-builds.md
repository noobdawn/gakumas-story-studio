# 单 build 与源码回退

用户只运行仓库的 `build/GSS.exe`，`scripts/start.ps1` 也指向这一份 build。该目录不进入 Git。源码、依赖和 Unity 工程属于开发输入，不分别作为用户验收版本。

首次开发安装运行 `scripts/bootstrap.ps1`。已有 build 时运行：

```powershell
./scripts/update-build.ps1 -Unity '你的 Unity.exe 路径' -Message '本次改动说明'
```

该脚本执行源码、Node、Python 检查，构建新的 Player，并借用当前 build 中的便携 Python 与媒体工具生成临时候选，验证后替换 build。第一次构建尚无 build 时，可显式传入 `-Tools` 与 `-PythonRuntime`；Python 使用 scripts/prepare-python.py 准备的版本。输入运行时版本变更时也应显式提供新运行时。

替换前要求关闭本仓库的工作台、Player 和 Unity 编辑器。验证失败保留原 build，临时产物清理掉；成功后只留当前 build 与 `.local/last-build-report`。中断或断电导致遗留临时目录时，先检查进程和 `.local/build-*/previous` 是否存有待恢复版本，再清理。常规组包使用 `--no-archive`；GitHub Release 工作流仍生成发布 ZIP。

`scripts/checkpoint.py --message '说明'` 会将本地源码提交并创建一个 `dev/<UTC时间>` 回退分支，最多保留最近 3 个，保护 main 与当前检出的分支。只调整本地 dev/* 引用，不推送、不清除 Git 历史对象。Git 共享源码对象，三个分支不会复制三套工作区。恢复时将需要的分支代码合并或检出，再重新生成唯一 build；这不恢复用户作品和游戏资源。

2026-11-15 的数据重置已经由用户单独授权。后续新建作品、重新解包的资源和声库不受本次删除授权影响。
