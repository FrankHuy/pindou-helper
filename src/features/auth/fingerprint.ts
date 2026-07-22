/**
 * Lightweight stable-ish visitor fingerprint (soft signal only).
 * Server stores SHA-256; never used as sole identity.
 */

const STORAGE_KEY = 'pd_client_fp_v1'

function fnv1a(str: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  // unsigned 32-bit hex
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function collectSignals(): string {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  const scr = typeof screen !== 'undefined' ? screen : null
  const parts = [
    nav?.userAgent ?? '',
    nav?.language ?? '',
    String(nav?.hardwareConcurrency ?? ''),
    String(nav?.maxTouchPoints ?? ''),
    scr ? `${scr.width}x${scr.height}x${scr.colorDepth}` : '',
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : '',
    String(new Date().getTimezoneOffset()),
  ]

  // Canvas sample (may be empty in some privacy browsers — still ok).
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 120
    canvas.height = 40
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.textBaseline = 'top'
      ctx.font = '14px Arial'
      ctx.fillStyle = '#1d574b'
      ctx.fillRect(0, 0, 120, 40)
      ctx.fillStyle = '#e2b43c'
      ctx.fillText('pindou-fp', 4, 10)
      parts.push(canvas.toDataURL().slice(-64))
    }
  } catch {
    parts.push('canvas-blocked')
  }

  return parts.join('|')
}

function randomId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Returns a stable client fingerprint string (localStorage + signals). */
export function getClientFingerprint(): string {
  if (typeof window === 'undefined') return 'ssr'
  try {
    const existing = localStorage.getItem(STORAGE_KEY)?.trim()
    if (existing && existing.length >= 16) return existing

    const signalHash = fnv1a(collectSignals())
    const id = `${signalHash}${randomId()}`
    localStorage.setItem(STORAGE_KEY, id)
    return id
  } catch {
    // Storage blocked — ephemeral id for this page load only.
    return `ephem-${fnv1a(collectSignals())}-${Date.now().toString(16)}`
  }
}
