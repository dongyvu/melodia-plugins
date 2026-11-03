# Last.fm 记录

把 Melodia 的听歌记录同步到 [Last.fm](https://www.last.fm)：开始播放时更新「正在播放」，达到计数条件后提交 scrobble。沙盒插件，桌面与 Android 都能用，需要 Melodia 提供插件 API 1.4。

## 使用

1. 导入 `lastfm.melodiaplugin`，在插件列表里点这个插件的设置按钮打开页面：桌面端在「设置 → 插件」，Android 在「设置 → 扩展 → 插件」。
2. 还没有 API 账号时，点「申请 API 账号」在 Last.fm 创建，回调地址可以留空，记下 API Key 和 Shared Secret。
3. 在页面里填好 API Key 和 Shared Secret，点「登录」，同意打开网页后在浏览器里允许授权，回到应用稍等几秒即登录完成。

## 计数规则

按 [Last.fm 官方规则](https://www.last.fm/api/scrobbling)：歌曲长于 30 秒，且实际播放过一半或满 4 分钟（取先到者）。

- 只累计实际播放的时间，暂停、拖动进度和休眠都不计入。
- 跳过的歌没达到条件就不提交；同一次播放最多提交一次。
- 单曲循环每播完一轮重新计数。
- 断网或 Last.fm 不可用时记录先存在本地（最多 1000 条），恢复后自动补交，也可以在插件页点「立即补交」。超过 14 天的记录 Last.fm 不再接受，会被丢弃。
- 网易歌曲在登录网易账号时会补上专辑名。

## 页面选项

所有选项都在插件列表设置按钮打开的页面里，不占音乐库侧栏。

| 选项 | 说明 |
|---|---|
| API Key / Shared Secret | 自己申请的 Last.fm API 账号；Secret 遮挡显示，保存后不回填，留空保存表示不修改 |
| 记录听歌（scrobble） | 默认开启 |
| 更新正在播放 | 默认开启 |
| 多位歌手时 | 只提交第一位（默认）；全部提交 |

换 API Key 后需要重新登录。退出登录会同时清掉还没补交的记录。

## 权限

| 权限 | 用途 |
|---|---|
| `network` | 只访问 `ws.audioscrobbler.com` |
| `playback.read` | 读取当前歌曲与播放进度 |
| `storage` | 保存 API 账号、页面选项、登录会话与待补交记录 |
| `ui.openUrl` | 打开 Last.fm 授权页，每次都会先询问 |
| `ui.notify` | 登录成功或失效时提示 |
| `netease.read` | 查询网易歌曲的专辑名 |

Shared Secret 与会话密钥不会写进日志，也不会显示在页面上；请求一律用 POST，会话密钥只出现在请求体里。

## 构建与测试

```powershell
node --test test/main.test.mjs
./build.ps1
```

产物在 `build/lastfm.melodiaplugin`，脚本会打印 SHA-256 和字节数。测试只用 Node 自带模块，以假的宿主加载 `main.js`，签名用 `node:crypto` 独立核对。

## 实现说明

- 沙盒里没有 md5，`main.js` 自带一份按 UTF-8 计算的实现。
- `songChanged` 只在换歌时触发，单曲循环靠 `progress` 里进度从结尾附近跳回开头来识别。
- 相邻两次 `progress` 的间隔超过 2.5 秒时只按 2.5 秒累计，避免休眠恢复后时长暴涨。
- 页面动作要在 5 秒内返回，登录与补交都在后台进行，结果写回页面。
- 点按钮时宿主会把页面数据作为参数传入（API 1.4），所以填完直接点「登录」也能拿到输入框里的内容。
- 输入框只在启动和保存后回填，定时刷新页面不会覆盖正在输入的内容。
