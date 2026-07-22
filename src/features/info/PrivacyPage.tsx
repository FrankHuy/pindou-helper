import './info.css'

type PrivacyPageProps = {
  onBack: () => void
}

export default function PrivacyPage({ onBack }: PrivacyPageProps) {
  return (
    <div className="info-page">
      <header className="info-topbar">
        <button type="button" className="info-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>隐私政策</h1>
      </header>

      <article className="info-article">
        <p className="info-lead">
          拼豆图纸助手在浏览器中提供拼豆图纸生成、工作间高亮等工具，并可选提供需登录的云端能力（例如后续 AI
          辅助）。本页说明我们如何对待你的图片、账号与相关数据。
        </p>

        <h2>拼豆图纸与工作间（本地处理）</h2>
        <p>
          图纸生成与工作间识别在当前设备完成：你选择的图片经浏览器内的画布与算法处理，用于预览、色号统计与导出。
          <strong>我们不会把你用于本地生成/高亮的原图上传到服务器。</strong>
        </p>

        <h2>账号与登录（可选能力）</h2>
        <p>
          若你使用注册/登录，我们会保存与账号相关的必要信息，例如：邮箱、密码的单向哈希（不可还原为明文密码）、登录会话、邮箱验证状态、角色与用量配额，以及为防滥用而记录的有限风控信号（如注册/调用时的
          IP、浏览器指纹哈希）。账号数据存放在本服务使用的 Cloudflare 基础设施中。
        </p>
        <p>
          注册与找回密码时，我们会向你的邮箱发送<strong>验证链接或重置链接</strong>（非短信）。邮件由我们配置的第三方发信服务代发。
        </p>
        <p>
          <strong>后续 AI 等可能产生外部调用成本的功能需要登录，并通常要求邮箱已验证；</strong>
          会按账号与全站策略限制次数，以控制滥用与费用。具体以产品内提示与当时可用功能为准。
        </p>

        <h2>小红书下图</h2>
        <p>
          「小红书下图」会将你粘贴的<strong>公开分享链接</strong>发送到本站服务端，由服务端代为请求公开页面与图片。
          不会使用你的小红书登录 Cookie。该功能可不登录使用；生产环境可能启用人机验证以减少刷量。请仅用于公开且你有权保存的素材。
        </p>

        <h2>不会做的事</h2>
        <ul>
          <li>不会把本地拼豆图纸主流程中的原图作为默认上传内容</li>
          <li>不会出售你的个人数据用于第三方广告画像</li>
          <li>不会在日志中记录你的明文密码</li>
        </ul>

        <h2>设备上的数据</h2>
        <p>
          应用可以安装为 PWA 并缓存静态资源，以便离线或加快加载。本地处理过程中的图片与图纸结果主要保留在当前页面会话中；你主动导出的文件保存在你的设备上。
        </p>

        <h2>导出</h2>
        <p>
          当你导出 PNG 图纸时，文件直接保存到你的设备。导出文件的后续使用与分享由你自行决定。
        </p>

        <h2>联系</h2>
        <p>
          如有隐私相关问题，请邮件联系：
          <a href="mailto:Frank@Frankiehu.top">Frank@Frankiehu.top</a>
        </p>

        <p className="info-updated">更新日期：2026-07-22</p>
      </article>
    </div>
  )
}
