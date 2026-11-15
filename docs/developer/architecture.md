# 模块与运行数据

Electron 管理窗口、文件选择与本机设置。Python 提供本机 HTTP/TCP 协调、资产准备和音视频处理。Unity 负责确定性演出采样及最终画面。前端预览和导出共用工程参数、演出时钟和效果类型契约。

runtime-paths.js 与 runtime_paths.py 从程序所在位置解析源码与运行时。默认数据位于 LOCALAPPDATA/GakumasStoryStudio；CREATOR_LIBRARY_DIR 可显式指定旧库。数据目录选择记在独立 location.json；不把个人路径编入公开代码。

通用预设位于 resources/common，按修订一次性安装到 shared；用户修改和主动删除不被覆盖。游戏资源位于当前受管理批次，缺失时返回初始化/准备入口，不从历史报告或其他批次补齐。

专用效果由 memory、television、soft 三套 shader include 与 pass 分派，演出时间驱动，保留 RenderStory 的 RT/sRGB try/finally 恢复。效果 v2 与旧通用包明确隔离；旧工程在副本中显式替换效果。

初始化向导依次处理目录、语音、游戏资源和完成。下载器固定组件 URL 与 SHA-256；拒绝越界归档路径和链接，失败保留已验证缓存，临时安装目录与成品目录分离。GPT-SoVITS 仍为已有本地配置接入。


## 界面布局与任务进度（2026-11-15）

基础控件在 controls.css，共享资产组件在 asset-settings.css，向导和工作台分别使用 setup-wizard.css 与 layout-responsive.css。向导固定顶部步骤和底部操作，中央独立滚动；工作台按实际工具栏高度分配空间，停靠面板有最小可用尺寸，空间不足时工作区可滚动。表单高度按字体行高和内边距计算，避免 CJK 文字被固定高度裁切。

窗口使用 Electron screen 的 DIP workArea 限制尺寸；跨屏移动、显示参数变化后重新约束。保留 Chromium 系统 DPI 缩放及 Unity 预览的 CSS/物理像素换算，显示比例变化时刷新预览坐标。API 依据：https://www.electronjs.org/docs/latest/api/screen 。

语音与解包各有独立进度条。语音下载显示当前文件字节进度和文件序号；校验、解压、安装显示不定进度。资源准备显示扫描、解包、Player 转换、2D 场景、面部特效、两类音频解码及结果检查阶段，明确为阶段估算，不估计剩余时间。取消、失败、部分完成分别呈现，只有成功完成显示满进度。

`apps/desktop/electron/tests/ui-layout-check.cjs` 由 Electron 以隐藏离屏窗口执行，使用人工 API 和页面夹具，覆盖 800×500 至 3840×2100 的逻辑视口、1/1.25/1.5/2 设备像素比、向导四步、模态滚动与任务状态。实际 Windows DPI、跨屏和 Unity 可见预览仍由用户验收。
