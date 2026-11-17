# 独立取色与文件配置

2026-11-17：所有 `input[type=color]` 的点击交给 `color-inputs.js`，阻止 Chromium 原生弹层，由 Electron `color-picker.js` 打开独立、置顶、可拖动的颜色窗口。提交后只向仍存在、未改值且未禁用的原控件发送 input/change；取消不写入工程，不额外制造撤销项。

屏幕取色先隐藏颜色窗口，通过 [desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer) 捕获各显示器，再为每个显示器建立独立置顶无边框窗口。按 `display_id` 配对、以显示器实际缩放请求捕获尺寸，采样按图像尺寸换算归一化坐标。负坐标显示器和混合 DPI 不依赖主窗口位置。最终颜色从原始 NativeImage 的 Windows BGRA 像素读取，不取放大镜或覆盖层上的像素。窗口行为依据 [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)，像素读取依据 [NativeImage](https://www.electronjs.org/docs/latest/api/native-image)。

预加载 API 仅暴露初始化、确认、屏幕取色和取消；主进程校验发送者所属窗口及主 frame，页面禁止导航、新窗口和网络资源。确认、取消、父窗口关闭、渲染进程退出、显示器变化和捕获失败均清理所有覆盖层。显示器变化的监听先于异步捕获／窗口加载，避免加载期间漏掉事件。120 秒未选取自动取消覆盖层。屏幕画面只在内存中传递。

`editable-prompt.js` 将 `translation-prompt.txt` 作为权威提示词，支持 UTF-8 / BOM，校验字数和空文件。启动只补缺失文件，保留原有 prompt 和词表，旧密钥文件不因迁移被重写。翻译请求每次读取；VOICEVOX 原有 cook 入口本就每次读取词表。界面保存携带读取时的内容哈希，拒绝明显过期的草稿，并提供文件重载。磁盘更新使用临时文件及 rename；外部编辑器不参与应用锁，冲突保护是提交前版本检查，不宣称跨应用事务。

`settings-files.js` 只接受 prompt / rules 两种固定文件标识，通过 shell.openPath / showItemInFolder 打开；没有由 renderer 传入任意路径。文件格式损坏时保留打开／定位入口供修复。数据目录写入继续经过 game write guard。

隐藏检查：`color-picker-check.cjs` 使用人工截图与两个假显示器，包括负坐标和不同缩放；验证正确像素、确认／取消、捕获失败、显示器变化、窗口清理及按钮可见。此检查加入 `update-build.ps1`。`settings-files-ui.cjs` 验证链接、重载错误、原生颜色提交／取消／控件失效；Node 配置测试验证迁移、不覆盖、外部热读、版本冲突、损坏文件修复和路径保护。真实屏幕取色、可见 Unity 遮挡和跨屏手感不由隐藏测试替代。
