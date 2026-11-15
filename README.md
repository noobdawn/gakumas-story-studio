# Gakumas Story Studio（GSS）

基于《学园偶像大师》本地资源的剧情演出与视频创作工具，中文工作名为「怪文书创作器」。用时间轴安排角色、对白、画面、声音与效果，并导出视频。

**当前状态：Windows 发布候选，尚未公开发布。** 项目许可证待定，制作人预设图的来源已记录、公开再分发依据尚待补充。可见预览与实际观感由用户验收；编译／无头检查不替代这一结论。

## 使用

便携发布包准备好后解压并运行 `GSS.exe`。首次进入初始化向导：选择数据目录与游戏目录 → 选择语音引擎／声库并下载 → 解包当前游戏资源 → 进入工作台。游戏目录只读，游戏资源不随软件分发。

具体操作见 [首次使用](docs/user/getting-started.md)。开发参与方式见 [CONTRIBUTING](CONTRIBUTING.md)。

通用预设包含制作人 8 张图片。VOICEVOX 引擎与稳定朗读声库通过向导按需下载、校验；可以先不安装语音。GPT-SoVITS 保留本地已有配置方式，尚无通用自动下载。

## 开发

- Node.js 22 或更新兼容版、Python 3.14、Unity 6000.3.24f1（Windows Build Support）。
- `./scripts/bootstrap.ps1`：创建本地 Python 环境并安装 Electron 依赖。
- `python scripts/check.py`：语法与预设清单校验，不需要游戏素材。
- `node --test apps/desktop/electron/tests/*.test.js`：工作台逻辑测试。Windows DPAPI 测试需正常用户上下文。
- `scripts/build-player.ps1`：底层 Unity 构建入口，须显式传入新的 `-Output` 临时目录，通常由 update-build.ps1 调用。
- `./scripts/start.ps1`：启动唯一的 `build/GSS.exe`；可通过 `-DataDirectory` 指定数据目录，通过 `-Project` 显式加载工程。
- `./scripts/update-build.ps1 -Unity '你的 Unity.exe 路径'`：验证并替换唯一 build，最多保留 3 个源码回退分支。详见 [单 build 工作流](docs/developer/local-builds.md)。

首次构建／依赖安装需网络。运行素材必须来自当前游戏对应的有效受管理批次，不回退研究样本。

## 目录

| 目录 | 职责 |
| --- | --- |
| apps/desktop | Electron 宿主与编辑界面 |
| services/host | Python 通信、演出与音视频处理 |
| services/importer | 只读扫描、资源转换与音频解码 |
| services/voice | 本地语音适配 |
| unity/CreatorPlayer | Unity 实际源码与工程设置 |
| resources | 通用预设、带哈希的运行时／声库下载清单 |
| scripts | 环境准备、检查、构建与打包 |
| docs/developer | 架构、发布流程与验证边界 |

主仓库：[noobdawn/gakumas-story-studio](https://github.com/noobdawn/gakumas-story-studio)。完整用户文档由 Sites 托管，本地源文件位于工作区旁的 documentation，不另建 GitHub 文档仓库。

## 已知限制

UI 转场拖入仍需面板确认、不能直接空白建轨；图片／视频接缝转场没有素材拖放入口；多素材批量拖入、复合片段、多镜头输出未实现。旧通用效果须在工程副本中显式替换为专用算法，操作可撤销。

发布配置见 [发布说明](docs/developer/releases.md)，资源来源见 [第三方说明](THIRD_PARTY_NOTICES.md)。工具不是游戏官方编辑器，实验性渲染不代表原游戏管线完整还原。
