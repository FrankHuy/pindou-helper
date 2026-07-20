# 拼豆图纸助手

面向 iPhone / iPad / 桌面浏览器的拼豆图纸生成与小红书公开帖高清图下载工具。

## 功能

### 拼豆图纸（本地）

- 上传本地图片，不上传服务器
- 设置图纸宽度，自动按原图比例计算高度
- 将图片转换为一格一颗豆的图纸
- 使用 MARD 色卡进行最近色匹配
- 显示/隐藏网格、色号
- 颜色用量统计
- 导出 PNG 图纸
- PWA 基础配置，可添加到 iOS/iPadOS 主屏幕

### 小红书下图

- 粘贴公开图文分享链接（`xiaohongshu.com` / `xhslink.com`）
- 解析帖内高清图并网格预览；有 `fileId` 时优先原图像素，无 `fileId` 或构造失败则回退公开页展示档
- 点击放大后逐张保存（同源 Worker 代理，带 Referer）
- 不支持私密帖、登录态或 ZIP 打包

## 本地开发

```bash
npm install
npm run dev
```

Vite + Cloudflare 插件会一并启动前端与 Worker（`/api/*`）。

## 构建验证

```bash
npm run build
npm run lint
npm run preview
```

`preview` / `deploy` 使用 Wrangler：静态资源 + Worker API。

## Cloudflare 部署

推荐使用 Wrangler（仓库已配置 `main` Worker + assets）：

```bash
npm run deploy
```

若使用 Cloudflare Pages/Workers 连接 Git 仓库：

- Build command: `npm run build`
- 以 Wrangler 配置（`wrangler.jsonc`）为准部署 Worker + SPA assets
- Environment variables: 暂不需要

部署后可以在 iPhone/iPad Safari 中打开站点，选择“分享 → 添加到主屏幕”。

## 色卡说明

色卡数据位于 `src/lib/palettes/`（MARD 全表与商家套装码表）。`src/lib/palette.ts` 为兼容 re-export。

## 隐私

- **拼豆图纸**：图片处理全部发生在浏览器本地：`File input → Canvas → ImageData → 图纸`。不会上传你的本地照片。
- **小红书下图**：会将你粘贴的**分享链接**发送到本站 Cloudflare Worker；Worker 代为请求小红书公开页面与图片 CDN（不携带、不存储你的登录 Cookie）。请仅用于公开且你有权保存的素材。
