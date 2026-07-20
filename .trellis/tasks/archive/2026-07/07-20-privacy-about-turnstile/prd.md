# Privacy / About 页面与 Cloudflare 防刷

## Goal

为站点补齐**合规信息页**（Privacy Policy、About）与**Cloudflare Turnstile 防刷**，降低 `/api/*` 被恶意刷量的风险；同时提供可选打赏入口与邮箱联系方式。

## Confirmed product decisions

1. **Privacy Policy 文案边界**  
   - **只描述拼豆工具**：本地图片处理、不上传用户照片、PWA 等  
   - **不出现**小红书 / 第三方分享链下载 / 相关 CDN 或 Worker 代拉第三方页面的描述  
2. **About**  
   - 产品定位：拼豆图纸助手  
   - 展示微信 + 支付宝收款码，旁文案：**「请作者喝一杯咖啡」**  
   - 联系邮箱：`Frank@Frankiehu.top`  
3. **收款码资源**  
   - 源文件在仓库 `pics/`：  
     - `pics/微信图片_20260720173154_324_2.jpg`  
     - `pics/微信图片_20260720173155_325_2.jpg`  
   - 实现时应复制/重命名到稳定 `public/` 路径（避免中文文件名与临时命名进生产 URL）  
   - **不标注**微信/支付宝标签；用户自行识别  
4. **防刷**  
   - 采用 Cloudflare **Turnstile**（用户已同意方向）  
   - 目标：防止网站被恶意刷量（重点保护会打上游的 API）  
   - **保护范围（已确认）**：仅 `POST /api/xhs/parse`（选项 A）；**不**校验 `/api/xhs/image`

## Requirements

### Must

- R1. 可访问的 **Privacy Policy** 页面（路由或独立视图），文案仅拼豆本地工具视角，无小红书相关表述  
- R2. 可访问的 **About** 页面：简介 + 邮箱 `Frank@Frankiehu.top` + 微信/支付宝收款码 +「请作者喝一杯咖啡」  
- R3. 主界面可发现入口（页脚或菜单链接到 Privacy / About）  
- R4. Cloudflare Turnstile 接入：前端取 token，Worker 校验；失败返回中文错误  
- R5. Turnstile **site key / secret** 不硬编码进公开仓库（secret 用 Wrangler secrets / 环境变量；site key 可为 public env）  
- R6. `npm run build` / `npm run lint` 通过；拼豆路径无回归  

### Should

- R7. 移动端可读的收款码布局（码可扫、文案清晰）  
- R8. Turnstile 在本地/无密钥时有明确降级策略（开发旁路或文档说明）  

### Out of scope (unless later decided)

- 完整法务审查级多语言隐私政策  
- 用户账户体系  
- 全站 WAF 规则编辑（仅应用内 Turnstile + 现有 allowlist）

## Acceptance Criteria

- [ ] AC1. Privacy 页可打开，全文无「小红书 / xhs / xhslink」等第三方下载相关表述  
- [ ] AC2. About 页展示两码 +「请作者喝一杯咖啡」+ 可点击/复制邮箱  
- [ ] AC3. 从主 UI 可进入两页并返回功能 Tab  
- [ ] AC4. 受保护 API 无有效 Turnstile token 时被拒绝；有效 token 可正常调用（在配置密钥的环境）  
- [ ] AC5. build + lint 通过  

## Open decisions (planning)

- （无阻塞项；路由与密钥约定见 design，默认采用推荐方案）

## Resolved

- 收款码：**不**区分标注微信/支付宝（用户已确认）
- Turnstile 范围：**仅** `POST /api/xhs/parse`（用户确认 A）
- 路由推荐：无 react-router；`/privacy` `/about` path + 页脚入口 + SPA fallback（见 design）

## Notes

- 当前无 react-router；实现可选轻量 path 或 App 内 `view` 状态  
- Privacy **刻意不写** XHS Worker 行为：与真实产品能力不完全一致，属产品合规表述选择，实现时严格按用户要求  
