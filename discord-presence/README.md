# Discord 听歌状态

在 Discord 上显示 Melodia 正在播放的歌曲。桌面原生插件，只支持 Windows。

## 安装

1. 在 Melodia「设置 → 插件」打开「允许原生插件」。
2. 导入 `discord-presence.melodiaplugin`，重启应用。

切歌、暂停和跳转进度都会同步。Discord 没有运行时插件在后台重试，打开 Discord 后自动连上。

## 设置

| 设置 | 选项 |
|---|---|
| 暂停时 | 清除状态（默认）；显示已暂停，30 分钟后清除 |

## 构建

需要 JDK 17 或更高版本：

```bash
./gradlew test packagePlugin
```

产物在 `build/plugin/discord-presence.melodiaplugin`。

`libs/plugin-api-1.3.jar` 由 [Melodia](https://github.com/rinchao0721/Melodia) 的 `:plugin-api:jar` 构建，只参与编译，不打进插件。

## 实现说明

- 没有第三方依赖，通过 `\\.\pipe\discord-ipc-N` 直连 Discord，协议见 [RPC 文档](https://docs.discord.com/developers/topics/rpc)。
- 官方文档的 `\\?\pipe\` 前缀在 JDK 里打不开。
- 对端退出后 `RandomAccessFile.length()` 仍返回 0，断线靠定时 PING 写入发现。
- 缓冲和切歌间隙 `isPlaying` 也是 false，持续 1.5 秒才按暂停处理。
- Discord 要求文本至少 2 个字符，单字歌名用零宽字符补齐。
- 没有公网地址的封面改用 Discord 应用里名为 `logo` 的图片。

## 许可

与 Melodia 相同。
