/**
 * Transactional email via Resend.
 * When RESEND_API_KEY is unset, log the action URL to console and still succeed
 * (local/dev). Never log passwords or raw tokens beyond the full URL needed for
 * manual testing in dev.
 */

export type MailEnv = {
  RESEND_API_KEY?: string
  MAIL_FROM?: string
}

export type SendMailResult = { ok: true; mode: 'resend' | 'console' } | { ok: false; message: string }

export async function sendAuthEmail(
  env: MailEnv,
  options: {
    to: string
    subject: string
    text: string
    html: string
  },
): Promise<SendMailResult> {
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.MAIL_FROM?.trim() || 'Pindou Helper <onboarding@resend.dev>'

  if (!apiKey) {
    // Dev fallback: operator can open the link from Worker logs.
    console.info('[auth-mail:dev]', {
      to: options.to,
      subject: options.subject,
      text: options.text,
    })
    return { ok: true, mode: 'console' }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [options.to],
        subject: options.subject,
        text: options.text,
        html: options.html,
      }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      console.error('[auth-mail] resend failed', response.status, detail.slice(0, 200))
      return { ok: false, message: '邮件发送失败，请稍后重试' }
    }
    return { ok: true, mode: 'resend' }
  } catch (err) {
    console.error('[auth-mail] resend error', err)
    return { ok: false, message: '邮件发送失败，请稍后重试' }
  }
}

export function buildVerifyEmail(origin: string, token: string): { subject: string; text: string; html: string } {
  const url = `${origin}/verify?token=${encodeURIComponent(token)}`
  const subject = '验证你的拼豆助手邮箱'
  const text = `请打开以下链接验证邮箱（24 小时内有效）：\n${url}\n\n如果不是你本人操作，请忽略此邮件。`
  const html = `<p>请点击以下链接验证邮箱（24 小时内有效）：</p><p><a href="${url}">${url}</a></p><p>如果不是你本人操作，请忽略此邮件。</p>`
  return { subject, text, html }
}

export function buildResetEmail(origin: string, token: string): { subject: string; text: string; html: string } {
  const url = `${origin}/reset?token=${encodeURIComponent(token)}`
  const subject = '重置拼豆助手密码'
  const text = `请打开以下链接重置密码（1 小时内有效）：\n${url}\n\n如果不是你本人操作，请忽略此邮件。`
  const html = `<p>请点击以下链接重置密码（1 小时内有效）：</p><p><a href="${url}">${url}</a></p><p>如果不是你本人操作，请忽略此邮件。</p>`
  return { subject, text, html }
}
