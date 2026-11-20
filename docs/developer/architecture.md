# 模块与运行数据

2026-11-17：颜色输入通过独立 Electron 窗口及多显示器捕获层取色，绕开主窗口裁切和 Unity 子窗口遮挡；提示词和词表支持外部文件编辑与版本检查。见 [独立取色与文件配置](color-picker-config.md)。

2026-11-17 角色姓名条颜色：`character-colors.js` 为面板、预览、图层合成、导出提供同一解析入口。工程资产可覆盖左右端颜色，单句覆盖优先；Unity 修正外部 sRGB 姓名条与对白底板的显示 RGB 转换。来源、序列化与回归范围见 [角色姓名条颜色](character-colors.md)。

2026-11-17 动画片段属性：`animation-layer-ui.js` 提供独立素材信息和搜索替换弹窗，`animation-layers.js.replaceMotion` 只变更 `assetId`、清零旧 `sourceOffset`，叠加层按新素材调整 `blendMode`。不另建片段／轨道或改名，不改剧情绑定、排时、循环及渐变。沿用 `remember`、`render` 和现有预览／导出求值、工程序列化；弹窗提交时复查工程／轨道／片段身份、锁定和当前资源定义。

2026-11-17 抗锯齿设置：工程 `render.antialiasing` 保留 0/1/2=关闭/FXAA/SMAA High，新增 3/4/5=MSAA 2/4/8、6=MSAA 4 + SMAA High。相机、URP asset、世界颜色/深度及 coverage 附件同步样本数，最终合成与编码输入仍为单采样；缩略图目标同样遵循选择。场景 G-buffer、原始描边权重和树叶材质不变，树叶透空差异已由用户接受。

导出设置 `globalSettings.exportSupersampling` 只接受整数 1/2，缺省 1；宿主作业将权威 `frameSupersampling` 传入串行和队列帧，帧中自带状态不能覆盖它。Player `creator-antialiasing-v1` 标记用于拒绝旧 Player 静默忽略超采样；打包要求此标记。World 渲染按该倍率放大并线性缩回，再沿原节点顺序合成；非原生兼容捕获也在叠加媒体/UI前缩回。捕获倍率、相机目标和活动纹理均由 finally 恢复。只在超采样的原生合成下跳过无效前置相机渲染，默认路径保持原行为。控制接口 `project.settings` 可选传入 `render` 部分参数及 `exportSupersampling`，沿用撤销与重绘。



2026-11-17 正常导出接入：原生图层合成工程默认使用 GPU 加速（NVIDIA），可选择兼容 PNG/x264；旧合成工程使用兼容模式。普通GPU入口采用8帧队列与完整工程范围，不依赖诊断开关，不保留逐帧报告。Player仅在GPU导出期间解除帧率/vSync限制，结束、取消、失败或销毁时恢复。原输出的临时文件/提交前检查仍有效，不静默从GPU失败切换编码设置。包必须携带原生DLL与production能力标记。历史诊断描述保留如下。

2026-11-17：新增显式 `fullProject:true` GPU 诊断，要求合并帧、4/8 帧队列、新输出及整个工程范围，上限 216,000 帧，Player 需 `creator-full-export-v1`。默认短区间限制不变。全片报告只留首尾、8 个最慢样本和阶段汇总；原生逐帧日志流式写盘，sidecar 流式校验的文件预算随帧数增长。仅全片控制命令超时为30分钟；状态/渲染/编码算法不变。一次本机1080p/30fps完整21:05影片导出174.92秒，37,951帧与音频时间轴检查通过；正常UI与唯一用户build未切换。

2026-11-17：合并 GPU 诊断新增 `queueCapacity:1/4/8`，每批最多 4 个不可变状态，Unity 连续按序消费。容量计入待执行、在途及未回收结果，并限制序列化状态字节数；入队/提交/编码分别计数。宿主生命周期事务互斥，会话号隔离迟到请求，取消安全排空当前帧；保留单张 display 纹理和原生 8 槽池。合并 GPU 诊断上限有限扩至 1,800 帧，其余仍为 300；正常 UI 未启用。两个短片矩阵及三组 60 秒 A/B 均通过对应画面/音频检查，完整影片及设备故障仍未验收。

2026-11-17：GPU诊断新增可选 `mergedFrame`，宿主将状态与权威帧参数合成 `state-frame` 单命令，Player沿用状态/媒体就绪流程后直接捕获并回复一次。只适用于1～300帧GPU诊断，有独立能力标记；正常导出默认保持原路径。原生插件另增加仅测试实例启用的逐帧输入/输出分段计时，指标为CPU墙钟而非GPU执行时间。

2026-11-17：新增默认关闭的 D3D11/NVENC 视频诊断出口，仅限 `video.benchmark`、原生最终合成、新目标文件及 1～300 帧。Unity 在 GPU 上做显示颜色与方向转换，原生模块用有界纹理池及异步 NVENC 生成无 B 帧 CFR H.264；宿主校验完成计数及逐帧时间戳后复用现有混音，采用视频 streamcopy 封装。正常 UI/PNG 导出仍保持原路径。源码和构建方式见 [GPU 出口原型](../../native/gpu-export/README.md)。本轮不替换唯一 build，未完成全片、所有颜色边界、设备故障及实际取消验收。

Electron 管理窗口、文件选择与本机设置。Python 提供本机 HTTP/TCP 协调、资产准备和音视频处理。Unity 负责确定性演出采样及最终画面。前端预览和导出共用工程参数、演出时钟和效果类型契约。

工作台到 Python 的本机 HTTP 使用 HTTP/1.1 持久连接，各响应带 Content-Length，避免逐帧创建 TCP 短连接。连接空闲 30 秒退出；禁用 Nagle，避免小型同步响应的额外延迟。请求体大小限制、Origin 与会话令牌校验仍保留；不支持的传输编码、重复／非法长度或不完整请求体会关闭连接，避免剩余字节被解析为下一条请求。完整读入后的 JSON／业务错误正常返回 JSON，可继续复用连接。Python 到 Unity 仍为原有鉴权 TCP 长连接。

runtime-paths.js 与 runtime_paths.py 从程序所在位置解析源码与运行时。默认数据位于 LOCALAPPDATA/GakumasStoryStudio；CREATOR_LIBRARY_DIR 可显式指定旧库。数据目录选择记在独立 location.json；不把个人路径编入公开代码。

离线视频编码按音频片段计算数量（最多 10,000），不将片段数当作轨道数。超过 32 个输入时按时间排序分组，去掉批次前的静音，在 48 kHz 双声道浮点 PCM 中混音；需要时继续分层合并，最终视频编码也最多接收 32 个音频输入。浮点中间结果不归一化、不提前削波，保留各段增益与时间位置；变速输出按样本重建时间戳。中间文件只在本次导出临时目录内，完成、取消或失败后清理。现有请求体大小、循环音频内存预算与输出覆盖保护仍生效。

通用预设位于 resources/common，按修订一次性安装到 shared；用户修改和主动删除不被覆盖。游戏资源位于当前受管理批次，缺失时返回初始化/准备入口，不从历史报告或其他批次补齐。

专用效果由 memory、television、soft 三套 shader include 与 pass 分派，演出时间驱动，保留 RenderStory 的 RT/sRGB try/finally 恢复。效果 v2 与旧通用包明确隔离；旧工程在副本中显式替换效果。

初始化向导依次处理目录、语音、游戏资源和完成。下载器固定组件 URL 与 SHA-256；拒绝越界归档路径和链接，失败保留已验证缓存，临时安装目录与成品目录分离。GPT-SoVITS 仍为已有本地配置接入。


## 角色物理的工程与运行时接口

工程 JSON 在 `state.globalSettings.physicsMode` 保存 `none`、`gss`、`quartz` 或 `hybrid`。新建工程写入 `hybrid`。保存时兼容字段 `physicsEnabled` 对应模式是否启用，只有 `none` 为 `false`。载入时接受单独的模式字段，两字段同时存在时须一致。只带旧开关的工程按 `true → quartz`、`false → none` 迁移。更早的工程若缺少整组全局设置，则读取旧手毬对象的开关，缺省为关闭。[工程校验](../../apps/desktop/electron/project-store.js) · [设置与快照](../../apps/desktop/ui/app.js)

工作台按同一工程快照驱动预览与导出。宿主通过 Player 随附的 `creator-physics-modes-v1` 标记识别四种模式。切换模式时，每个角色实例重新初始化自己的求解历史，在暂停的同一帧也会应用新选择。[模式与兼容请求](../../apps/desktop/ui/render-settings.js) · [时间轴步进](../../unity/CreatorPlayer/Assets/Runtime/ActorPhysicsPlayback.cs)

启用物理时，工作台在状态包标明工程帧率 `physicsFrameRate` 和从零开始的工程帧号 `physicsFrame`。整数帧按 `frame * 60 / rate` 的整数商取得已完成的物理步数。帧间定位传帧号 −1，Player 沿用双精度演出时间。早期状态包也可从合成时间或演员自身的动作时钟推进。反复请求同一姿势和时刻只呈现一次。[工作台快照](../../apps/desktop/ui/app.js) · [固定步回归](../../unity/CreatorPlayer/Assets/Editor/CreatorMotionTransitionTests.cs)

Hybrid 播放身体动作淡入、淡出时，两段姿势的头部落点可能相距数厘米。混合权重改变的子步会在同一组动作时间和动画层上取前后两个权重的姿势，用所得头部变换搬移头发的两份 Verlet 历史位置。动作自身的转头、移动、重力和碰撞随后继续参与求解。暂停、跳时和更换不连续姿势仍沿用各自的重建逻辑。[动作混合采样](../../unity/CreatorPlayer/Assets/Runtime/ActorPhysicsPlayback.cs) · [头发历史位置](../../unity/CreatorPlayer/Assets/Runtime/ActorClothPhysics.cs)

GSS、Quartz 和 Hybrid 都在显示前用变形后的发片检查额头。连续播放时，每束前发记住上次实际显示的局部关节旋转。修正幅度随经过的时间和骨链本身的运动变化，插值后的发片还会对当帧脸部三角形复查。共享顶点触及皮肤时会重试上一姿势，必要时采用已检查的当帧解。Hybrid 在修正尚未到位时逐帧复查。跳时、换解算方式和重新初始化角色会清除这一段接触历史。[额头网格接触](../../unity/CreatorPlayer/Assets/Runtime/FringeFaceContact.cs)

GSS 用经典骨链求解二次运动。Quartz 先根据当前服装或发型的模型驱动更新锚点，再按演出时钟以 60 Hz 积分，应用模型提供的各轴限位与横向连接。Hybrid 沿用这一步，在被识别为前发和鬓角的骨段上分别使用 12° 和 22° 的局部软限幅，同时修正发梢的位置历史。额头接触精查以 15 Hz 为目标，中间帧复用每束发丝的修正权重。姿势、位置或额头表面变化超过复用条件时，当帧重新检查。[模型驱动](../../unity/CreatorPlayer/Assets/Runtime/ActorQuartzPose.cs) · [骨链与限幅](../../unity/CreatorPlayer/Assets/Runtime/ActorClothPhysics.cs) · [额头接触](../../unity/CreatorPlayer/Assets/Runtime/FringeFaceContact.cs)

## 界面布局与任务进度（2026-11-15）

基础控件在 controls.css，共享资产组件在 asset-settings.css，向导和工作台分别使用 setup-wizard.css 与 layout-responsive.css。向导固定顶部步骤和底部操作，中央独立滚动；工作台按实际工具栏高度分配空间，停靠面板有最小可用尺寸，空间不足时工作区可滚动。表单高度按字体行高和内边距计算，避免 CJK 文字被固定高度裁切。

窗口使用 Electron screen 的 DIP workArea 限制尺寸；跨屏移动、显示参数变化后重新约束。保留 Chromium 系统 DPI 缩放及 Unity 预览的 CSS/物理像素换算，显示比例变化时刷新预览坐标。API 依据：[Electron screen](https://www.electronjs.org/docs/latest/api/screen)。

语音与解包各有独立进度条。语音下载显示当前文件字节进度和文件序号；校验、解压、安装显示不定进度。资源准备显示扫描、解包、Player 转换、2D 场景、面部特效、两类音频解码及结果检查阶段，明确为阶段估算，不估计剩余时间。取消、失败、部分完成分别呈现，只有成功完成显示满进度。

`apps/desktop/electron/tests/ui-layout-check.cjs` 由 Electron 以隐藏离屏窗口执行，使用人工 API 和页面夹具，覆盖 800×500 至 3840×2100 的逻辑视口、1/1.25/1.5/2 设备像素比、向导四步、模态滚动与任务状态。实际 Windows DPI、跨屏和 Unity 可见预览仍由用户验收。


## 公共编辑器默认配置

resources/editor-defaults/defaults.json 保存用户指定随版本分发的完整翻译提示词及 180 条发音替换词，manifest.json 校验修订、哈希和条目数。翻译服务与词表存储直接读取同一数据源；前端恢复默认通过读取接口返回的 defaultPrompt/defaults 使用同一版本，不另维护缩减词表。无配置文件时读取默认；已有自定义提示词、词表及空词表保持原值。恢复默认仅修改设置草稿，保存后生效，保留 API Key 密文。打包校验包含资源存在性和实际 Node 模块加载结果。
