/** Load a File or blob URL into ImageData (full resolution). */
export async function fileToImageData(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('无法读取图片')
    ctx.drawImage(bitmap, 0, 0)
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

/** Crop a horizontal band [y0, y1) from ImageData. */
export function cropRows(source: ImageData, y0: number, y1: number): ImageData {
  const top = Math.max(0, Math.min(source.height, Math.floor(y0)))
  const bottom = Math.max(top, Math.min(source.height, Math.ceil(y1)))
  const height = Math.max(1, bottom - top)
  const width = source.width
  const data = new Uint8ClampedArray(width * height * 4)

  for (let row = 0; row < height; row += 1) {
    const srcOffset = ((top + row) * width) * 4
    const dstOffset = row * width * 4
    data.set(source.data.subarray(srcOffset, srcOffset + width * 4), dstOffset)
  }

  return new ImageData(data, width, height)
}

/** Downscale ImageData so max dimension ≤ maxDim (nearest for speed). */
export function downscaleImageData(source: ImageData, maxDim: number): ImageData {
  const maxSide = Math.max(source.width, source.height)
  if (maxSide <= maxDim) return source

  const scale = maxDim / maxSide
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return source
  ctx.putImageData(source, 0, 0)

  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const octx = out.getContext('2d', { willReadFrequently: true })
  if (!octx) return source
  octx.imageSmoothingEnabled = false
  octx.drawImage(canvas, 0, 0, width, height)
  return octx.getImageData(0, 0, width, height)
}

/** Median of channel samples (odd length preferred). */
export function medianByte(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
