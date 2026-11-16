# 漫序 Studio

macOS 漫剧创作工作台，支持角色卡、提示词和分镜管理。

公开版本可在本机整理项目、编辑分镜与角色卡、用本地模板编排提示词、查看参考片采样帧和导入或导出项目。示例使用虚构的《灯塔来信》。项目数据与导入素材在本机处理，公开版使用单独的本地工作空间。

## 本地运行

需要 Node.js 22.12+ 和 npm。

```sh
npm ci
npm run dev
```

在 macOS 上运行桌面版：

```sh
npm run build
npm start
```

运行逻辑检查：`npm run check`。
