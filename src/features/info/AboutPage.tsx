import './info.css'

type AboutPageProps = {
  onBack: () => void
}

export default function AboutPage({ onBack }: AboutPageProps) {
  return (
    <div className="info-page">
      <header className="info-topbar">
        <button type="button" className="info-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>关于</h1>
      </header>

      <article className="info-article">
        <p className="info-lead">
          <strong>拼豆图纸助手</strong>
          帮助你在手机或电脑浏览器里，把图片快速转成可预览、可导出的拼豆图纸，并统计色号用量。
        </p>

        <h2>联系邮箱</h2>
        <p>
          <a className="info-email" href="mailto:Frank@Frankiehu.top">
            Frank@Frankiehu.top
          </a>
        </p>

        <section className="info-tip" aria-label="支持作者">
          <h2>请作者喝一杯咖啡</h2>
          <p className="info-tip-copy">如果工具对你有帮助，欢迎扫码支持（可选）。</p>
          <div className="info-qr-row">
            <figure className="info-qr">
              <img src="/tip/qr-a.jpg" alt="收款码" width={200} height={200} loading="lazy" />
            </figure>
            <figure className="info-qr">
              <img src="/tip/qr-b.jpg" alt="收款码" width={200} height={200} loading="lazy" />
            </figure>
          </div>
        </section>
      </article>
    </div>
  )
}
