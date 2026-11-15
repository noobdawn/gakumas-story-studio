# 模块与运行数据

Electron 管理窗口、文件选择与本机设置。Python 提供本机 HTTP/TCP 协调、资产准备和音视频处理。Unity 负责确定性演出采样及最终画面。前端预览和导出共用工程参数、演出时钟和效果类型契约。

runtime-paths.js 与 runtime_paths.py 从程序所在位置解析源码与运行时。默认数据位于 LOCALAPPDATA/GakumasStoryStudio；CREATOR_LIBRARY_DIR 可显式指定旧库。数据目录选择记在独立 location.json；不把个人路径编入公开代码。

通用预设位于 resources/common，按修订一次性安装到 shared；用户修改和主动删除不被覆盖。游戏资源位于当前受管理批次，缺失时返回初始化/准备入口，不从历史报告或其他批次补齐。

专用效果由 memory、television、soft 三套 shader include 与 pass 分派，演出时间驱动，保留 RenderStory 的 RT/sRGB try/finally 恢复。效果 v2 与旧通用包明确隔离；旧工程在副本中显式替换效果。

初始化向导依次处理目录、语音、游戏资源和完成。下载器固定组件 URL 与 SHA-256；拒绝越界归档路径和链接，失败保留已验证缓存，临时安装目录与成品目录分离。GPT-SoVITS 仍为已有本地配置接入。
