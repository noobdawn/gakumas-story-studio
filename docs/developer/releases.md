# 自动发布流程

更新：2026-11-15。主仓库为 [noobdawn/gakumas-story-studio](https://github.com/noobdawn/gakumas-story-studio)，简称 GSS。文档改为 Sites 托管，保留独立本地源码。

## 程序

普通 push/PR 在 GitHub 托管 Windows runner 做源码与逻辑检查。版本标签 `v*` 触发单独的 Release workflow，构建使用已安装 Unity 6000.3.24f1 且许可可用的专用 Windows runner，标签包括 `self-hosted, Windows, X64, gss-release`。不给 PR 配置此 runner。

在仓库建立 release environment，配置变量 GSS_UNITY（Unity.exe）及 GSS_TOOLS（ffmpeg.exe、ffprobe.exe、vgmstream-cli.exe、所需 DLL 和 THIRD_PARTY_NOTICES.txt 所在目录）。为发布分支／标签及 environment 设置维护者保护。源码版本与标签必须一致。

顺序：依赖安装 → Node／Python 检查 → Unity 人工 GPU 检查与构建 → 便携 Python 准备 → Electron/Player/Python/工具/预设组包 → 哈希清单 → 上传 artifact → 托管 runner 使用最小 contents:write 权限创建 Release。只有成功构建才进入发布；带连字符的版本标为 prerelease。失败不上传半成品 Release，不覆盖同名已发布版本。

当前 release-policy.json 保持关闭：代码许可证、制作人图片的公开再分发依据、具体媒体工具构建的分发材料待确认。分别更新 projectLicense、commonAssetsRedistribution、runtimeToolsRedistribution 后再启用 releaseEnabled。CI 脚本已经准备，用户已创建主仓库；尚未推送源码或配置 runner，GitHub 实际发布未测试。

## 本地组包

日常只保留 `build/`，使用 [单 build 工作流](local-builds.md)；`--no-archive` 不生成重复 ZIP。发布工作流仍输出 ZIP 与 SHA-256 供 GitHub Release 下载。

使用 scripts/prepare-python.py 准备新的便携 Python 目录。scripts/package.py 通过 --python、--tools、--player 指向明确运行时输入，--output 必须为新目录。输出包含 GSS.exe、运行时、通用预设、源码与哈希；不包含用户库、密钥、游戏资源或 Unity Library。

本地候选工具输入已保留 FFmpeg 6.0（Gyan full build）的 GPL v3 文件与构建 README，以及 vgmstream r2168 的 COPYING、README、USAGE。当前仅用于本机候选验证，公开版本还需确定工具构建及其完整分发材料；不要仅凭文件名 THIRD_PARTY_NOTICES.txt 判断已经审核完毕。

源码包含完整声音下载清单；引擎和声库由用户向导安装到数据目录，不默认占用下载包体积。新版本预设使用稳定 ID 和修订标记，已有用户修改不被覆盖。

## 独立文档站

documentation 保留 content/*.json、assets 和 Python 静态构建器；由 Sites 保存源码及托管，不放到 GitHub。site.json 已配置主仓库与 Releases 链接。运行 python scripts/build.py 校验本地链接后，使用 Sites 发布同一源码版本。

## 官方依据

- [GitHub Release CLI](https://cli.github.com/manual/gh_release_create)：标签校验、自动发行说明和 prerelease。
- [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)：Pages artifact、部署权限与 environment。
- [Unity 6000.3 命令行构建](https://docs.unity.com/en-us/engine/6000.3/manual/building-and-publishing/build-command-line)：批处理显式选择目标平台与工程。
- [VOICEVOX Core 使用方式](https://github.com/VOICEVOX/voicevox_core/blob/main/docs/guide/user/usage.md)：Core、ONNX Runtime、词典与 VVM 依赖分工。

## 维护边界

软件包自动发布与应用内自动更新是不同能力；本轮只实现前者的工作流，没有后台自动下载并替换正在运行的创作器。可见预览、真实桌面拖放和导出仍按用户手动验收结果记录。
