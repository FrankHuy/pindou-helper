/**
 * Port of scripts/xhs_image_demo.py pure helpers:
 * state_from_page / find_note / highest_image_url / token extract + CDN builders
 */

import type { NoteImage, NoteRecord } from './types'

const INITIAL_STATE_RE = /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/

/** Default original-quality CDN host (matches XHS-Downloader / finalized HD script). */
export const ORIGINAL_CDN_HOST = 'sns-img-bd.xhscdn.com'

const FILE_ID_RE = /^[A-Za-z0-9_-]+$/

/** Decode HTML entities used in the embedded state payload. */
function htmlUnescape(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

/**
 * Read the JS object assigned to window.__INITIAL_STATE__ from public note HTML.
 * XHS emits a few JavaScript-only `undefined` values — normalize before JSON.parse.
 */
export function stateFromPage(page: string): unknown {
  const match = page.match(INITIAL_STATE_RE)
  if (!match) {
    throw new Error('STATE_NOT_FOUND')
  }
  const payload = match[1].replace(/:undefined(?=[,}])/g, ':null')
  return JSON.parse(htmlUnescape(payload)) as unknown
}

/** Locate the note object rather than depending on a volatile state path. */
export function findNote(state: unknown): NoteRecord {
  if (state && typeof state === 'object') {
    if (Array.isArray(state)) {
      for (const value of state) {
        try {
          return findNote(value)
        } catch {
          // keep searching
        }
      }
    } else {
      const record = state as Record<string, unknown>
      const images = record.imageList
      if (Array.isArray(images) && images.length > 0) {
        return record as NoteRecord
      }
      for (const value of Object.values(record)) {
        try {
          return findNote(value)
        } catch {
          // keep searching
        }
      }
    }
  }
  throw new Error('NOTE_NOT_FOUND')
}

/** Prefer WB_DFT / original-style URL over preview derivatives. */
export function highestImageUrl(image: NoteImage): string {
  const info = image.infoList ?? []
  for (const preferred of ['WB_DFT', 'WB_ORI', 'WB_HQ', 'WB_PRV'] as const) {
    for (const item of info) {
      if (item.imageScene === preferred && item.url) {
        return item.url
      }
    }
  }
  for (const key of ['urlDefault', 'url', 'urlPre'] as const) {
    const value = image[key]
    if (value) return value
  }
  throw new Error('IMAGE_URL_MISSING')
}

/** Reject empty / path-injection fileId values before constructing CDN URLs. */
export function isValidFileId(fileId: unknown): fileId is string {
  if (typeof fileId !== 'string') return false
  const id = fileId.trim()
  if (!id) return false
  // Block path / query injection even on allowlisted hosts.
  if (/[/?#\s]/.test(id)) return false
  return FILE_ID_RE.test(id)
}

/**
 * Extract opaque CDN token (fileId) from a page-provided image URL.
 * - Strips `!nd_…` transformation suffixes
 * - webpic hosts: path is `/{ts}/{hash}/{fileId}!suffix` → skip first two segments
 * - other hosts: path after host is the token (usually equals bare fileId)
 */
export function extractFileIdFromUrl(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null
  let normalized = rawUrl.trim()
  if (!normalized) return null
  if (normalized.startsWith('//')) {
    normalized = `https:${normalized}`
  } else if (normalized.startsWith('http://')) {
    normalized = `https://${normalized.slice('http://'.length)}`
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    return null
  }

  // Path without leading slash; drop empty segments from trailing slash.
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null

  let tokenPath: string
  if (parsed.hostname.toLowerCase().includes('webpic')) {
    // /{timestamp}/{hash}/{fileId}[!suffix]
    if (segments.length < 3) return null
    tokenPath = segments.slice(2).join('/')
  } else {
    tokenPath = segments.join('/')
  }

  // CDN transform suffix is after `!` on the last path segment (or whole path).
  const token = tokenPath.split('!')[0]?.trim() ?? ''
  if (!isValidFileId(token)) return null
  return token
}

/** Ordered candidate URLs for token extraction (scene preference + top-level). */
function candidateUrlsForToken(image: NoteImage): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const push = (value: unknown) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    urls.push(trimmed)
  }

  const info = image.infoList ?? []
  for (const preferred of ['WB_DFT', 'WB_ORI', 'WB_HQ', 'WB_PRV'] as const) {
    for (const item of info) {
      if (item.imageScene === preferred) push(item.url)
    }
  }
  for (const item of info) {
    push(item.url)
  }
  for (const key of ['urlDefault', 'url', 'urlPre'] as const) {
    push(image[key])
  }
  return urls
}

/**
 * Resolve bare fileId / CDN token for an image.
 * Prefer page `fileId`, else extract from infoList / top-level URLs.
 */
export function resolveToken(image: NoteImage): string | null {
  if (isValidFileId(image.fileId)) {
    return image.fileId.trim()
  }
  for (const url of candidateUrlsForToken(image)) {
    const token = extractFileIdFromUrl(url)
    if (token) return token
  }
  return null
}

/**
 * Build bare original CDN URL from fileId/token (no imageView2, no !suffix).
 * Bare originals may be HEIC / octet-stream — use jpgUrlFromFileId for JPG.
 */
export function originalUrlFromFileId(
  fileId: string,
  host = ORIGINAL_CDN_HOST,
): string {
  if (!isValidFileId(fileId)) {
    throw new Error('INVALID_FILE_ID')
  }
  return `https://${host}/${encodeURIComponent(fileId.trim())}`
}

/**
 * CDN-transcoded JPG of the same token (higher-res than WB_DFT webpic).
 */
export function jpgUrlFromFileId(fileId: string, host = ORIGINAL_CDN_HOST): string {
  if (!isValidFileId(fileId)) {
    throw new Error('INVALID_FILE_ID')
  }
  return `https://${host}/${encodeURIComponent(fileId.trim())}?imageView2/2/w/0/format/jpg`
}

/**
 * Prefer bare sns-img-bd original from token; fall back to public-page infoList URLs.
 */
export function resolveImageSourceUrl(image: NoteImage): string {
  const token = resolveToken(image)
  if (token) {
    return originalUrlFromFileId(token)
  }
  return highestImageUrl(image)
}
