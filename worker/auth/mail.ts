/**
 * Transactional email via Resend.
 *
 * When RESEND_API_KEY is unset: do NOT claim the email was delivered.
 * We still log the verify/reset URL for local/dev operators (`mode: 'console'`).
 * Never log passwords or raw tokens beyond the full URL needed for manual testing.
 */

export type MailEnv = {
  RESEND_API_KEY?: string
  MAIL_FROM?: string
}

export type SendMailResult =
  | { ok: true; mode: 'resend'; id?: string }
  | { ok: false; mode: 'console' | 'resend'; message: string }

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
    // Callers must treat this as "not delivered" (ok: false).
    console.info('[auth-mail:dev] RESEND_API_KEY missing — email not sent', {
      to: options.to,
      subject: options.subject,
      from,
      text: options.text,
    })
    return {
      ok: false,
      mode: 'console',
      message:
        '服务器未配置 RESEND_API_KEY，验证邮件未发出（请在 Cloudflare Worker 运行时 Secrets 中配置）',
    }
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
    const detail = await response.text().catch(() => '')
    if (!response.ok) {
      console.error('[auth-mail] resend failed', {
        status: response.status,
        from,
        to: options.to,
        detail: detail.slice(0, 500),
      })
      // Surface common Resend setup issues without leaking secrets.
      let message = '邮件发送失败，请稍后重试'
      if (response.status === 401 || response.status === 403) {
        message =
          '邮件服务认证失败：请检查 RESEND_API_KEY 是否有效，以及 MAIL_FROM 域名是否已在 Resend 验证'
      } else if (response.status === 422) {
        message =
          '邮件参数被拒绝：请检查 MAIL_FROM 格式（如 拼豆助手 <noreply@你的已验证域名>）与收件邮箱'
      }
      return { ok: false, mode: 'resend', message }
    }

    let id: string | undefined
    try {
      const parsed = JSON.parse(detail) as { id?: string }
      if (typeof parsed.id === 'string') id = parsed.id
    } catch {
      // ignore non-JSON success body
    }
    console.info('[auth-mail] resend ok', { to: options.to, from, id: id ?? null })
    return { ok: true, mode: 'resend', id }
  } catch (err) {
    console.error('[auth-mail] resend error', err)
    return { ok: false, mode: 'resend', message: '邮件发送失败，请稍后重试' }
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
