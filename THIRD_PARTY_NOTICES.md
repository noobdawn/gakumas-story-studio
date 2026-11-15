# 第三方与资源来源

本清单是发布候选的来源登记，不将所有第三方内容套用项目许可证。

| 内容 | 来源与处理 |
| --- | --- |
| 制作人 8 张预设图 | 用户说明原版出自 YouTube 视频作者 **Pドキドキ文芸科**；具体视频链接及公开再分发依据待补充。文件已纳入本地候选并记录哈希；公开发布开关保持关闭 |
| 游戏模型、纹理、动作、Shader、声音 | 不包含在仓库和发布包；只读本地游戏并生成用户受管理缓存 |
| Electron | 固定版本 39.2.7；便携包保留 Electron/Chromium 随附许可证文件 |
| Python | 官方 CPython 3.14.0 嵌入式发行版；保留随附许可；第三方 Python 包保留 dist-info 与许可证 |
| Unity Runtime / URP | 通过已许可的 Editor 构建；不分发 Unity Editor，不将 Unity 代码声明为项目原创 |
| VOICEVOX Core / ONNX Runtime | 通过固定 URL 与 SHA-256 下载；保留组件原始说明和许可证，见 https://github.com/VOICEVOX/voicevox_core |
| VOICEVOX 声库 | 模型 0.17.0 的稳定朗读库；使用条件按模型及角色分别确认，见 https://github.com/VOICEVOX/voicevox_vvm/blob/0.17.0/README.md |
| Open JTalk 词典 | pyopenjtalk 上游维护者 r9y9 的 v1.11.1 分发，安装时保留词典版权文件 |
| GPT-SoVITS | 仅提供本地配置适配，不在当前候选包中附带模型、参考音频或第三方引擎代码 |
| FFmpeg / FFprobe / vgmstream | 由发布运行时输入提供；必须连同匹配版本的许可与来源说明，不从个人安装目录不加说明地上传 |

对软件发布及声库使用条件的最终确认尚未完成。维护者在确定项目许可证和预设资源公开发布依据后更新 release-policy.json。
