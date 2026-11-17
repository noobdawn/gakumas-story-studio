# 角色姓名条颜色

2026-11-17：角色资产属性提供左右端颜色、渐变预览、恢复默认。修改仅影响本工程并支持撤销、重做和保存重载。未手动设色的对白会跟随角色；单句 `nameColor` / `nameColorEnd` 优先。设置用于游戏素材对话框，普通对话框与简洁字幕保持原有样式。

`character-colors.js` 统一解析角色素材 ID、工程资产别名、场景角色实例名和已知中日文姓名。多个不同角色共用一个名字时不猜测归属；未知名字使用游戏通用配色。资产覆盖值保存在 `state.assets[]` 的可选 `nameColor` / `nameColorEnd`，必须同时为六位十六进制颜色。目录中尚未加入工程的角色在首次编辑时创建工程覆盖记录。旧工程无需重写。

预览状态、图层合成包、导出字幕计划共用取色函数。此前图层合成包直接读取对白字段，缺少字段时回退灰色，导致属性面板的自动颜色没有传入画面。另外 `CreatorDialogueLayer` 的面板与姓名条属于 sRGB 纹理，采样后为线性值；UI 图合成器在显示 RGB 空间混合，需要将这两种外部纹理标记 `linearInput`，避免二次变暗。字体仍只读 alpha。游戏配色的姓名文字用 `labelTextColor`；手动背景色根据亮度自动选择深浅文字。原生图层、旧预览路径和兼容 ASS 导出同步传递文字颜色。

## 配色依据

官网角色页面的主题色不等于游戏对白渐变。官网交叉参考：[角色一览](https://gakuen.idolmaster-official.jp/idol/)、[手毬](https://gakuen.idolmaster-official.jp/idol/temari/)。本功能采用本机游戏的 `ADVCharacterSettingAsset` 中 `CharacterData.gradientColor1`、`gradientColor2` 和 `labelTextColor`；使用只读 IL2CPP v31 元数据确认字段顺序。原始资产及提取报告保留本机研究目录，不随发布包分发。

核对对象：`gakumas_Data/data.unity3d` → `resources.assets:853603`；序列化对象 SHA-256 与全部 23 个记录见工作区 `research/nameplate-colors-20261117-v1/game-colors.json`。21 个 characters 加 userCharacter / otherCharacter，读取结束位置与对象字节数完全一致。源码仅登记下列颜色数值和角色名称，不包含游戏纹理或模型。

| 角色 | 左端 | 右端 | 姓名文字 |
| --- | --- | --- | --- |
| 月村手毬 | #26B4EB | #87E9E2 | #FFFFFF |
| 花海咲季 | #FF5064 | #FFBBA7 | #FFFFFF |
| 藤田ことね | #F8D721 | #FFB5DA | #333333 |
| 有村麻央 | #C45DC9 | #FDAFA6 | #FFFFFF |
| 葛城リーリヤ | #D2E3E5 | #94CCD9 | #333333 |
| 倉本千奈 | #FF8A22 | #FF5D57 | #FFFFFF |
| 紫雲清夏 | #92DE5A | #CEE21D | #333333 |
| 篠澤広 | #00BED8 | #577DFF | #FFFFFF |
| 姫崎莉波 | #FD7EC2 | #F4B9FF | #FFFFFF |
| 花海佑芽 | #F74B2C | #F0CB4F | #FFFFFF |
| 十王星南 | #FFAD29 | #F5EB6E | #333333 |
| 秦谷美鈴 | #6EA4FC | #D4AFFF | #FFFFFF |
| 雨夜燕 | #8874FF | #C8BAFF | #FFFFFF |
| 根緒亜紗里 | #988D83 | #988D83 | #FFFFFF |
| 賀陽燐羽 | #988D83 | #988D83 | #FFFFFF |

燐羽未在已核对的角色配置中找到专属条目，因此使用 `otherCharacter` 的游戏通用默认，并在面板明确标注；这不是已验证的燐羽专属颜色。暂未核对剧情指令是否另行覆盖该角色，不将旧版经验值或官网不存在的颜色称为官方配置。

## 检查边界

逻辑测试覆盖官方默认、角色覆盖与单句优先级、别名与实例名、歧义、保存重载和非法值。隐藏 Electron 检查颜色编辑、默认恢复、撤销和窄面板布局。Unity 构建运行 6 项真实 GPU 像素检查；当前受管理批次的真实姓名条纹理另做 6 组新旧 Player 对照、18 点采样（误差不超过 3/255）。测试使用人工对白，没有载入或保存用户作品。可见工作台与长片导出仍由用户验收。
