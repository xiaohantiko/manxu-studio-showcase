# 漫序 Studio 公开版更新日志

## 0.3.1 · 2026-11-18

- 发布 Mac 完整版。首次使用模型连接时，在本机创建自己的管理员账号，绑定 OpenAI 或兼容服务。OpenAI 预设为 GPT‑6.2 Sol。
- 导入参考片后，可用六张采样帧生成流程拆解，并据此生成含角色卡、分镜和提示词的原创项目。改写会保留当前编辑稿供下一版使用。
- 支持独立绑定自建腾讯云备份服务。项目在 Mac 上加密上传，用文件密码恢复。本次发布包含磁盘和 COS 两种后端的源代码及部署说明。
- 沿用 0.3.0 公开版的本机工作区。使用原有项目时，在原位置更新 App 即可。

## 0.3.0 · 2026-11-18

- 提示词工坊现在从正在编辑的稿子开始修改。手工调整过的句子能带入下一版，保存后可以在「版本记录」找回。
- Mac 工作区改用 AES-256-GCM 加密保存，密钥由 macOS 钥匙串保护。项目、角色卡、分镜和提示词可导出为带独立密码的 `.manxu` 文件。「项目空间」可解锁备份，也支持导入旧版 JSON 项目。
- 更新本地角色卡、分镜、参考片采样与新手课程的使用说明，补充了 15 秒创作练习、备份恢复和 Mac 更新步骤。[使用说明](README.md)

## 0.1.0 · 2026-11-16

首个公开版提供独立工作区、虚构示例《灯塔来信》、角色卡与固定特征、模板提示词及版本记录。创作者可以编辑分镜、导出文本、在本机提取参考画面，并通过 JSON 文件备份和导入项目。该版本同时提供 Apple Silicon Mac 安装包和 SHA-256 校验文件。[查看 0.1.0 发布记录](https://github.com/xiaohantiko/manxu-studio-showcase/releases/tag/public-f2ece5a23281)

[下载 Apple Silicon Mac 安装包](https://github.com/xiaohantiko/manxu-studio-showcase/releases/latest/download/Manxu-Studio-macOS-arm64.dmg) · [查看各次发布记录](https://github.com/xiaohantiko/manxu-studio-showcase/releases)
