# 提升小红书下载原图像素清晰度

## Goal

让「小红书下图」在公开帖场景下尽量拿到**接近原图的像素**（与 kukutool 一类工具同级），而不是公开页 `WB_DFT` 常见的约 1080 展示档。

## Background / Confirmed Facts

对公开帖 `6a58ee61000000000f016925` 实测：

| 来源 | 分辨率 | 体积 | 说明 |
|------|--------|------|------|
| 页面元数据 `image.width/height` | 1948×2560 | — | 仅尺寸标记，不是可下载链 |
| 公开 `infoList` `WB_DFT`（当前实现） | 1080×1419 | ~250KB | `sns-webpic-*.xhscdn.com/.../fileId!nd_dft_...` |
| 竞品直链（用户提供，已复现） | 1948×2560 | ~568KB | 见下 |

**可用原图构造（已用 Worker 同类 UA + Referer 拉通）：**

```text
https://sns-img-hw.xhscdn.com/{fileId}?imageView2/2/w/0/format/jpg
```

同构可用：

- `sns-img-qc.xhscdn.com` / `sns-img-bd.xhscdn.com` + 同上 query → 同为 1948×2560 / 568KB
- 无 query 的 `sns-img-hw.../{fileId}` → 200 但可能是 HEIC 等原容器
- 简单改写 `sns-webpic` 的 `!nd_dft` / 去 bang → 403/404，**不可行**

页面 `imageList[]` 已含 `fileId`（例：`1040g2sg322mhfpagn0004becoqbja980hfkbaoo`），当前 Worker 解析后**未使用**该字段。

合规边界（继承上代任务）：仅公开帖；不登录、不存 Cookie、不引导绕过私密帖。

## Requirements

### Must

- R1. 当 note image 带有可用 `fileId` 时，优先用原图 CDN 构造高清 URL（`sns-img-*` + `imageView2/2/w/0/format/jpg` 或等价已验证形态），再经现有同源代理下载
- R2. 无 `fileId` 或原图构造失败时，回退到现有 `infoList` / `urlDefault` 策略，中文错误不白屏
- R3. 图片代理 allowlist 覆盖 `sns-img-*.xhscdn.com`（及验证需要的 host），保持 SSRF 防护与 redirect 校验
- R4. 同一验收帖：下载结果分辨率与体积应达到原图档（例：1948×2560 量级），明显优于 1080 展示档
- R5. 拼豆 Tab 与现有 parse/proxy 合同不回归；`npm run build` / `npm run lint` 通过

### Should

- R6. 多 host 回退（hw/qc/bd）若单一节点失败
- R7. UI/README 可选一句说明：优先原图像素，失败则展示档

### Out of Scope

- 登录态 / 私密帖
- 视频正文
- ZIP 打包
- 保证 100% 帖子都有原图（无 fileId 时允许回退）

## Decisions

1. 根因：公开 HTML 只给 webpic 展示链；竞品用 `fileId` 直打 `sns-img-*` 原图接口  
2. **MVP**：有合法 `fileId` 时构造  
   `https://sns-img-hw.xhscdn.com/{fileId}?imageView2/2/w/0/format/jpg`  
   经现有 `/api/xhs/image` 代理；失败或无 fileId 时回退现有 `infoList`/`urlDefault`  
3. 强制 `format/jpg`，避免裸 fileId 返回 HEIC  
4. 不登录、不存 Cookie；不在 parse 阶段做昂贵原图探测（后续可加 host 回退）  
5. 用户已确认「按这个 MVP」

## Acceptance Criteria

- [ ] AC1. 验收帖（或同类有 fileId 的公开图文）下载 ≥ 元数据宽高档，而非仅 1080 展示档
- [ ] AC2. 无 fileId / 原图 403 时回退展示档或中文错误，可重试
- [ ] AC3. 非 allowlist host 仍被拒绝（SSRF）
- [ ] AC4. 拼豆路径无回归；build + lint 通过

## Notes

- 研究样本链：`https://sns-img-hw.xhscdn.com/1040g2sg322mhfpagn0004becoqbja980hfkbaoo?imageView2/2/w/0/format/jpg`
- 实现前仍需 `design.md` / `implement.md`（allowlist、构造函数、回退顺序、失败矩阵）
