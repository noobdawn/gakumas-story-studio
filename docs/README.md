# 文档入口

GSS 当前是 Windows 开发预览版。源码、程序下载包与用户数据分别管理；发布状态以仓库 README 和 GitHub Releases 为准。

## 使用

- 让角色直视镜头、盯住场景里的某处或暂时看开，见[角色注视与移开目光](user/getting-started.md#角色注视与移开目光)。
- 给微笑或为难的角色配音，或把旧对白改为缓慢开合，见[对白口型的缓慢开合](user/getting-started.md#对白口型的缓慢开合)。
- 选择角色物理和调整画质，见[渲染与角色物理](user/getting-started.md#渲染与角色物理)。四种方式随工程保存，新工程默认 Hybrid。
- [从标记剧本到演出工程](user/script-direction.md) 汇总逐句动作与心理表演、换场弹窗、日语配音、音效选曲及 V04 至 V06 的验证结果。
- [文件编辑与屏幕取色](user/editable-settings.md)：提示词、替换词文件链接及独立颜色窗口。
- [首次使用](user/getting-started.md)：选择目录、安装语音、准备游戏资源、查看进度及恢复默认翻译配置。
- [更新记录](../CHANGELOG.md)：本轮功能变化和已知限制。
- [公共默认配置](../resources/editor-defaults/README.md)：翻译提示词与发音词表的来源、修订和覆盖规则。

## 开发与验证

- 工程字段、旧开关兼容和 Unity 求解顺序见[角色物理的工程与运行时接口](developer/architecture.md#角色物理的工程与运行时接口)。双角色切换、同帧对照和视频解码结果见[安装版验证](developer/validation.md#角色物理与渲染设置)。
- [模块与运行数据](developer/architecture.md)：Electron、Python、Unity 的分工，界面布局及任务进度。
- [角色姓名条颜色](developer/character-colors.md)：默认渐变来源、角色覆盖、单句优先级和色彩修复。
- [单 build 工作流](developer/local-builds.md)：更新唯一测试版本与保留三个本地源码回退点。
- [验证记录](developer/validation.md)：已执行检查、设备缩放模拟和待完成的真机验收。
- GPU 出口、有界队列和全片计时见[优化阶段总结](developer/export-performance.md)，普通导出窗口的选项见[视频导出方式](user/getting-started.md#视频导出方式)。
- [自动发布流程](developer/releases.md)：GitHub Checks、版本标签、Windows runner 与 Release 发布条件。
- [参与开发](../CONTRIBUTING.md)、[开发约束](../AGENTS.md)、[第三方来源](../THIRD_PARTY_NOTICES.md)。

完整文档站使用 Sites 单独管理；这里的说明可随源码独立阅读。个人作品、游戏缓存、声库、密钥和本机研究目录不进入本仓库。
