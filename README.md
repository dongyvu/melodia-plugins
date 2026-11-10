# Melodia 插件目录

[Melodia](https://github.com/rinchao0721/Melodia) 应用内「插件目录」读取的就是这里的 `index.json`。

- **在线浏览与下载**：<https://rinchao0721.github.io/melodia-plugins/>
- **插件规范**：[plugin-format.md](https://github.com/rinchao0721/Melodia/blob/dev/docs/plugin-format.md)，写插件前先看这份
- **目录格式**：[plugin-catalog.md](https://github.com/rinchao0721/Melodia/blob/dev/docs/plugin-catalog.md)

## 提交插件

向本仓库发 PR，在 `index.json` 的 `plugins` 里加一条：

```json
{
  "id": "com.example.hello",
  "name": "示例",
  "version": "1.0.0",
  "kind": "sandbox",
  "author": "作者",
  "description": "一句话说明",
  "platforms": ["desktop", "android"],
  "apiVersion": "1.0",
  "permissions": ["storage"],
  "source": "https://github.com/作者/仓库",
  "screenshots": [
    { "url": "https://example.com/shot-1.png", "label": "播放页" }
  ],
  "download": {
    "url": "https://github.com/作者/仓库/releases/download/v1.0.0/hello.melodiaplugin",
    "sha256": "64 位小写十六进制",
    "size": 12345
  }
}
```

`id`、`version`、`kind` 要和包内 `plugin.json` 一致，否则应用会拒绝安装。`download.url` 只能是 https，`size` 是插件包的字节数；沙盒插件不超过 10MB，原生插件不超过 200MB。`screenshots` 可选，用于在目录网页展示预览图（仅限 https，可填图片地址字符串或 `{ "url": "...", "label": "说明" }`）。

字段说明见 [plugin-catalog.md](https://github.com/rinchao0721/Melodia/blob/dev/docs/plugin-catalog.md)。

计算哈希（Windows）：

```powershell
(Get-FileHash hello.melodiaplugin -Algorithm SHA256).Hash.ToLower()
```

## 审核要求

所有插件：

- 包能在应用里手动导入并正常运行。
- 权限与功能相符，域名范围不宽于实际需要。
- 同一版本号发布后不再替换包内容；要改内容就升版本。

原生插件在主进程运行，等同于运行任意程序，额外要求：

- `source` 必填，提供可构建的源码，审核按对应版本的代码进行。
- 审核者要能从源码构建出同样的 `plugin.jar`，或者由审核者构建后发布。
- 不接受混淆代码，不接受运行时下载并执行代码。
- 带 DLL 的插件要说明来源，优先使用能核对来源的公开发行版。

## 更新插件

发新版本时修改对应条目的 `version` 和 `download`，同样走 PR。应用只提示更新，不会自动安装。
