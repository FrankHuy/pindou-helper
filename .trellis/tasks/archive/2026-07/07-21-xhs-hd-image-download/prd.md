# XHS HD image download strategy upgrade

## Goal

让「小红书下图」默认拿到与竞品/定稿脚本一致的原图像素与体积；并提供可选「兼容 JPG」开关（契约双路径），兼顾浏览器预览与保存兼容。

## Root cause (confirmed)

- 页面 `WB_DFT` URL 带 `!nd_dft_wlteh_*` 等 CDN 转码尾缀 → ~1080p web 图。
- 现网 `sns-img-hw/{fileId}?imageView2/2/w/0/format/jpg` 会二次转码，清晰度仍落后裸原图。
- 定稿脚本：`fileId`（或从 URL 去 `!` 抽 token）→ `https://sns-img-bd.xhscdn.com/{token}` 裸 URL；与 XHS-Downloader `sns-img-bd` 文件大小一致。部分原图为 HEIC。

参考脚本：`/root/projects/XHS-Downloader/xhs_hd_image_downloader.py`。

## Product decisions

| 决策 | 结论 |
|------|------|
| 默认清晰度 | 裸原图（方案 C 的默认支） |
| 兼容 JPG | CDN 同 token + `imageView2/2/w/0/format/jpg`，**不是** `WB_DFT` |
| 暴露方式 | **1+4**：解析契约每张图 `proxyPath` + 可选 `proxyPathJpg`；UI 全局开关「兼容 JPG」 |
| 开关默认 | **关**（默认保存/预览原图） |
| 开关打开 | 预览与保存优先用 `proxyPathJpg`（无则回退 `proxyPath`） |

## Requirements

1. Worker 选图对齐定稿：优先 `fileId` → `sns-img-bd` 裸 URL。
2. 无 `fileId`：从 `urlDefault` / `infoList` / `url*` 抽 token（去 `!…`；webpic path 跳过 timestamp/hash 两段）→ 同一 host 裸 URL。
3. 抽 token 失败：回退页面暴露的完整 HTTPS URL（现有 `highestImageUrl` 场景序可保留）。
4. 有 token 时额外构造 JPG URL，经 allowlist 后写入 `proxyPathJpg`。
5. 图片代理：允许真图但 `Content-Type` 非 `image/*`（如 `octet-stream`）；用 magic bytes 校验；可纠正响应 Content-Type / 前端扩展名（含 heic）。
6. 前端：全局「兼容 JPG」开关；类型与 `saveImage` 扩展名映射同步。
7. 同步 `scripts/xhs_image_demo.py` 与 `.trellis/spec/frontend/xhs-download.md`。
8. 安全：无 XHS cookie 登录绕过、同域 proxy、SSRF allowlist、token 防 path/query 注入。

## Out of scope

- 登录态 / 私密帖
- 视频帖
- Worker 本地 HEIC 解码转码（只依赖 CDN `imageView2`）
- 每张图独立双按钮、ZIP 打包

## Acceptance Criteria

- [ ] 有 `fileId` 时默认上游为 `https://sns-img-bd.xhscdn.com/{fileId}`（无 `imageView2`、无 `!nd_…`）
- [ ] 可选 JPG 为同 token + `?imageView2/2/w/0/format/jpg`，经 `/api/xhs/image?u=` 暴露为 `proxyPathJpg`
- [ ] 无 `fileId` 时仍能从带 `!` 的 URL 抽 token 拼原图
- [ ] 代理不因真图 `octet-stream` 误杀；HEIC 可存为 `.heic`
- [ ] UI 全局开关默认关；打开后预览/保存走 JPG 路径
- [ ] 样例级清晰度接近定稿脚本 / 竞品，显著优于纯 `WB_DFT`
- [ ] `npm run build` / `npm run lint` 通过；spec + offline demo 与实现一致
- [ ] SSRF / 同域 proxy / 无 cookie 约束保持

## Notes

- 纠正历史任务 `07-20-xhs-original-image-quality` 的「默认 format/jpg」。
- 单任务交付（Worker + 代理 + 前端最小开关 + demo + spec），不拆子任务。
