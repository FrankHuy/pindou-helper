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
          拼豆图纸助手是一款在浏览器中运行的拼豆图纸生成工具。本页说明我们如何对待你的图片与设备数据。
        </p>

        <h2>本地处理</h2>
        <p>
          图纸生成在当前设备完成：你选择的图片经浏览器内的画布与算法转换为拼豆图纸，用于预览、色号统计与导出。
          <strong>我们不会把你的本地照片上传到服务器。</strong>
        </p>

        <h2>不会收集的内容</h2>
        <ul>
          <li>不要求注册或登录</li>
          <li>不上传用于生成图纸的原图文件</li>
          <li>不建立用户画像或广告追踪账户体系</li>
        </ul>

        <h2>设备上的数据</h2>
        <p>
          应用可以安装为 PWA 并缓存静态资源，以便离线或加快加载。处理过程中的图片与图纸结果主要保留在当前页面会话中；关闭标签页后，未主动导出的内容通常不会持久保存在我们的服务器上。
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

        <p className="info-updated">更新日期：2026-07-20</p>
      </article>
    </div>
  )
}
