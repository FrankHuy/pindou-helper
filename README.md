# 拼豆图纸助手

面向 iPhone / iPad / 桌面浏览器的拼豆图纸生成、已有图纸按色高亮，以及小红书公开帖高清图下载工具。

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

### 拼豆工作间（本地）

- 上传本工具导出的「上图下图例」图纸（或同类第三方图）
- 自动估计图案/图例分界，可拖动分隔线后重新识别
- 从图例色块匹配 MARD 色号（无 OCR），点击色号 dim 高亮对应豆子
- 优先格点重建预览，失败则像素掩膜模式；图片仅在当前设备处理

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

### Turnstile 防刷（可选但推荐生产开启）

仅保护 `POST /api/xhs/parse`（图片代理不校验）。

前端通过 `GET /api/config` 读取 **运行时** Site Key 再渲染验证框（不依赖 Vite 构建期注入，适合 Cloudflare Git 自动构建）。

1. 在 Cloudflare Dashboard 创建 Turnstile 站点，取得 **Site Key** 与 **Secret Key**，域名填你的生产域名  
2. 在 Worker **运行时** Variables / Secrets 配置：

| 名称 | 类型 | 值 |
|------|------|----|
| `TURNSTILE_SITE_KEY` | 变量（明文） | Site Key（`0x…`） |
| `TURNSTILE_SECRET` | 机密 Secret | Secret Key |

也兼容把 Site Key 写成运行时变量名 `VITE_TURNSTILE_SITE_KEY`（同一值）。  

3. 本地可用：

```bash
npx wrangler secret put TURNSTILE_SECRET
# Site Key 可用 .dev.vars：
# TURNSTILE_SITE_KEY=0x...
```

4. 改完变量后 **重新部署** Worker（`npx wrangler deploy` 或 Git 推送触发部署）。  

本地未配置 `TURNSTILE_SECRET` 时，解析接口会跳过人机校验，便于开发。  
可选：构建变量 `VITE_TURNSTILE_SITE_KEY` 仍可作为无 `/api/config` 时的回退，**不再作为唯一来源**。

部署后可以在 iPhone/iPad Safari 中打开站点，选择“分享 → 添加到主屏幕”。

## 色卡说明

色卡数据位于 `src/lib/palettes/`（MARD 全表与商家套装码表）。`src/lib/palette.ts` 为兼容 re-export。

## 隐私与关于

- 站内页面：`/privacy`（隐私政策）、`/about`（关于 / 联系 / 可选打赏）
- **拼豆图纸**：图片处理全部发生在浏览器本地：`File input → Canvas → ImageData → 图纸`。不会上传你的本地照片。
- **小红书下图**：会将你粘贴的**分享链接**发送到本站 Cloudflare Worker；Worker 代为请求小红书公开页面与图片 CDN（不携带、不存储你的登录 Cookie）。请仅用于公开且你有权保存的素材。生产环境建议开启 Turnstile 限制解析刷量。
