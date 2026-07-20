/** Shared XHS worker types and API contracts. */

export type XhsErrorCode =
  | 'invalid_url'
  | 'login_required'
  | 'not_image_note'
  | 'parse_failed'
  | 'upstream_failed'
  | 'turnstile_failed'

export type XhsErrorBody = {
  error: XhsErrorCode
  message: string
}

export type XhsImageItem = {
  index: number
  width: number
  height: number
  proxyPath: string
}

export type XhsParseSuccess = {
  title: string
  resolvedUrl: string
  images: XhsImageItem[]
}

export type NoteImage = {
  infoList?: Array<{ imageScene?: string; url?: string }>
  urlDefault?: string
  url?: string
  urlPre?: string
  /** Opaque media id used to construct original sns-img CDN URLs. */
  fileId?: string
  width?: number
  height?: number
}

export type NoteRecord = {
  title?: string
  imageList: NoteImage[]
  [key: string]: unknown
}

export const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export const XHS_REFERER = 'https://www.xiaohongshu.com/'
