# 拼豆图纸助手

面向 iPhone / iPad / 桌面浏览器的纯前端拼豆图纸生成 MVP。上传图片后，应用会在当前设备本地完成像素化、MARD 色卡匹配、图纸预览、颜色用量统计和 PNG 导出。

## MVP 功能

- 上传本地图片，不上传服务器
- 设置图纸宽度，自动按原图比例计算高度
- 将图片转换为一格一颗豆的图纸
- 使用 MARD 基础色卡进行最近色匹配
- 显示/隐藏网格
- 显示/隐藏色号
- 颜色用量统计
- 导出 PNG 图纸
- PWA 基础配置，可添加到 iOS/iPadOS 主屏幕

## 本地开发

```bash
npm install
npm run dev
```

## 构建验证

```bash
npm run build
npm run preview
```

## Cloudflare Pages 部署

在 Cloudflare Pages 中连接 GitHub 仓库后使用：

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: 留空
- Environment variables: 暂不需要

部署后可以在 iPhone/iPad Safari 中打开站点，选择“分享 → 添加到主屏幕”。

## 色卡说明

当前版本内置的是 `src/lib/palette.ts` 中的 MARD 基础色 MVP 数据，用于验证完整产品流程。色卡被独立封装为数组，后续拿到完整、可核验的 MARD 官方/标准 HEX 色表后，可以直接替换该文件，不需要改动图纸算法。

## 隐私

图片处理全部发生在浏览器本地：`File input -> Canvas -> ImageData -> 图纸`。MVP 不包含登录、后端 API 或图片上传。
