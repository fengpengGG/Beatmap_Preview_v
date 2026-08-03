# Beatmap Preview

osu!mania 谱面游玩预览插件，基于 [tosu](https://github.com/tosuapp/tosu)。在选歌界面实时显示类似于实际游玩时的下落式音符预览动画。

![Preview](https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=osu!mania%20gameplay%20style%20beatmap%20preview%20with%20falling%20notes%2C%20dark%20theme%2C%20vertical%20layout%2C%204-key%20columns%20with%20purple%20notes%20falling%20downward%2C%20judgment%20line%20at%20bottom%2C%20retro%20gaming%20aesthetic&image_size=landscape_16_9)

## 功能

- 选择歌曲时自动显示对应谱面的实时音符下落预览
- 支持 1K ~ 10K+ 的多键模式，列宽自动适应
- 支持圆角方块 / 圆形两种音符样式
- LN 长条实时动画，被按住后头部持续显示直到释放
- 同一首歌切换不同难度时，预览时间连续不中断
- 可自定义画布大小、流速、颜色、音符厚度

## 安装

1. 确保已安装 [tosu](https://github.com/tosuapp/tosu)
2. 将本文件夹放入 tosu 的 `static` 目录下
3. 启动 tosu，在 Dashboard (`http://127.0.0.1:24050`) 中添加本插件
4. 进入 osu! 选歌界面即可看到预览效果

```
tosu/
├── static/
│   └── Beatmap_Preview_v/   ← 放这里
│       ├── index.html
│       ├── index.js
│       ├── settings.json
│       ├── metadata.txt
│       ├── js/
│       └── styles/
```

## 设置

在 tosu Dashboard 中点击插件右侧的齿轮图标进入设置面板。

| 设置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| Canvas 宽度 | 数字 | 300 | 预览窗口宽度（px） |
| Canvas 高度 | 数字 | 600 | 预览窗口高度（px） |
| 主菜单也显示 | 开关 | 关闭 | 开启后主菜单也会显示预览 |
| 显示判定线 | 开关 | 开启 | 显示/隐藏底部判定线 |
| 圆形音符 | 开关 | 关闭 | 开启 = 圆形，关闭 = 圆角方块 |
| 音符特效 | 开关 | 开启 | 开启 = 高光 + LN 渐变，关闭 = 纯色 |
| 音符厚度 | 数字 | 20 | 方块模式下音符高度（px） |
| 音符流速 | 数字 | 25 | 下落速度（1 = 最慢, 40 = 最快） |
| 轨道 1~4 颜色 | 颜色 | #c8c8eb | 四条轨道音符的独立颜色 |
| LN 颜色 | 颜色 | #9696c3 | 长按音符的颜色 |
| 调试日志 | 开关 | 关闭 | 控制台输出详细调试信息 |

> **多键模式提示**：5K 及以上的额外轨道会自动使用轨道 1 的颜色。
> **流速说明**：数值越大下落越快，25 对应约 460ms 的可见窗口，1 对应约 11485ms。

## 快捷键

本插件无快捷键，所有操作通过 tosu Dashboard 完成。

## 常见问题

**Q: 选歌界面什么都不显示？**
A: 检查浏览器控制台是否有错误信息，确认 osu! 当前处于 Song Select 界面。如果问题持续，开启"调试日志"查看详细日志。

**Q: 显示的键数和谱面不符？**
A: 插件会自动根据 `.osu` 文件中的 CircleSize 识别键数。如果显示异常，请确认谱面是 osu!mania 模式。

**Q: 如何用于 OBS 直播？**
A: 在 OBS 中添加"浏览器"源，URL 填写 `http://127.0.0.1:24050/Beatmap_Preview_v/`，宽高建议设为 300×600。

## 致谢

- [tosu](https://github.com/tosuapp/tosu) - osu! 内存读取与 WebSocket 服务
- [4kbeatmap_preview](https://github.com/) - Python 版预览算法参考
