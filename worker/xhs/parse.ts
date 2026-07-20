/**
 * Port of scripts/xhs_image_demo.py pure helpers:
 * state_from_page / find_note / highest_image_url
 */

import type { NoteImage, NoteRecord } from './types'

const INITIAL_STATE_RE = /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/

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
  for (const preferred of ['WB_DFT', 'WB_ORI', 'WB_PRV'] as const) {
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

const FILE_ID_RE = /^[A-Za-z0-9_-]+$/

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
 * Build competitor-style original image URL from fileId.
 * Force format/jpg so bare HEIC containers are not returned.
 */
export function originalUrlFromFileId(
  fileId: string,
  host = 'sns-img-hw.xhscdn.com',
): string {
  if (!isValidFileId(fileId)) {
    throw new Error('INVALID_FILE_ID')
  }
  return `https://${host}/${encodeURIComponent(fileId.trim())}?imageView2/2/w/0/format/jpg`
}

/**
 * Prefer original sns-img CDN from fileId; fall back to public-page infoList URLs.
 */
export function resolveImageSourceUrl(image: NoteImage): string {
  if (isValidFileId(image.fileId)) {
    return originalUrlFromFileId(image.fileId)
  }
  return highestImageUrl(image)
}
