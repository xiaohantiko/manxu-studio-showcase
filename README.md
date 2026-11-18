# 漫序 Studio

漫序 Studio 是一款面向 Apple Silicon Mac 的 AI 漫剧创作工作台。用 GPT 编写和修改提示词、设计角色卡、拆解参考片，再把拆解报告转成可编辑的分镜项目。每位创作者可以连接自己的模型和加密备份服务。

**下载 Mac 完整版**　[安装包（DMG）](https://github.com/xiaohantiko/manxu-studio-showcase/releases/latest/download/Manxu-Studio-macOS-arm64.dmg) · [发布记录与 SHA-256](https://github.com/xiaohantiko/manxu-studio-showcase/releases/latest) · [更新日志](CHANGELOG.md)

## 安装或从 0.3.0 升级

打开 DMG，把「漫序 Studio 公开版.app」拖到「应用程序」。升级前退出旧版，在原位置替换应用。0.3.1 沿用公开版工作区，重新打开即可继续编辑原有项目。DMG 使用临时签名，尚未通过 Apple 公证。下载校验文件后，可在同一目录运行 `shasum -a 256 -c SHA256SUMS.txt`。

## 第一次接入 GPT

1. 打开「管理后台」，创建这台 Mac 的管理员账号和密码。本地管理员负责配置模型和备份服务。
2. 在「模型绑定」选择「OpenAI GPT」，默认模型为 `gpt-6.2-sol`。填写自己的 OpenAI API Key，点击「保存连接配置」。
3. 点击「测试连接」。应用发送一张内置双色图验证读图能力，成功后启用 API 模式。模型请求由所选服务商按账户用量计费。[GPT-6.2 Sol 模型说明](https://developers.openai.com/api/docs/models/gpt-6.2-sol)

## 做第一段漫剧

- 在「新手学院」跟做 15 秒创作练习，学习建立项目、固定角色外貌、让镜头动作前后连贯。[图文操作步骤](USAGE.md)
- 在「参考片拆解」导入本地视频，检查六张带时间的采样帧，点「开始 AI 拆解」。报告区分可见事实与可能的制作步骤。模型分析的是采样画面，音轨留在本机。
- 点击报告下的「生成原创练习项目」，获得角色卡、分镜和首版提示词。在「提示词工坊」编辑当前稿，写下修改要求，再把修改结果存为新版本。

## 保存与恢复

Mac 使用钥匙串保护工作区加密密钥。角色、提示词、分镜和模型配置加密保存在本机。选择「项目空间 → 加密导出备份」可生成带独立密码的 `.manxu` 文件。恢复需要原文件密码，请把它保存在自己的密码管理器中。

云备份可独立配置。在自己的腾讯云上部署随仓库提供的后端，然后在「管理后台 → 独立腾讯云备份」填写 HTTPS 地址和访问令牌。检测连接成功后，在「项目空间 → 腾讯云备份」点击「加密并上传当前项目」。文件会先在 Mac 加密，恢复时再在 Mac 解密。后端支持专用磁盘目录或私有 COS 存储桶。[后端部署与恢复说明](cloud/README.md)

## 从源码运行

Mac 上需要 Node.js 22.12 或更高版本及 npm。在项目目录运行以下命令。

```sh
npm ci
npm run check
npm run build
npm start
```

`npm run dev` 启动浏览器界面预览，预览期间的编辑保存在页面内存。`npm run pack:mac` 构建 Apple Silicon 桌面应用。桌面主进程包含模型调用和钥匙串存储，云后端源码位于 `cloud/`。
