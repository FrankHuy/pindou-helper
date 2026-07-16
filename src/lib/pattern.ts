import type { BeadColor } from './palette'

export type PatternCell = BeadColor

export type BeadPattern = {
  width: number
  height: number
  cells: PatternCell[]
  counts: Map<string, number>
}

const colorDistance = (rgb: [number, number, number], candidate: BeadColor) => {
  const meanRed = (rgb[0] + candidate.rgb[0]) / 2
  const red = rgb[0] - candidate.rgb[0]
  const green = rgb[1] - candidate.rgb[1]
  const blue = rgb[2] - candidate.rgb[2]

  return Math.sqrt(
    (2 + meanRed / 256) * red * red +
      4 * green * green +
      (2 + (255 - meanRed) / 256) * blue * blue,
  )
}

const closestColor = (rgb: [number, number, number], palette: BeadColor[]) => {
  let closest = palette[0]
  let closestDistance = Number.POSITIVE_INFINITY

  for (const candidate of palette) {
    const distance = colorDistance(rgb, candidate)
    if (distance < closestDistance) {
      closest = candidate
      closestDistance = distance
    }
  }

  return closest
}

export async function createPattern(
  file: File,
  targetWidth: number,
  palette: BeadColor[],
): Promise<BeadPattern> {
  const bitmap = await createImageBitmap(file)
  const width = Math.max(8, Math.min(160, Math.round(targetWidth)))
  const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) throw new Error('当前浏览器无法处理图片。')

  context.imageSmoothingEnabled = true
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const pixels = context.getImageData(0, 0, width, height).data
  const cells: PatternCell[] = []
  const counts = new Map<string, number>()

  for (let index = 0; index < pixels.length; index += 4) {
    const matched = closestColor([pixels[index], pixels[index + 1], pixels[index + 2]], palette)
    cells.push(matched)
    counts.set(matched.code, (counts.get(matched.code) ?? 0) + 1)
  }

  return { width, height, cells, counts }
}

export type DrawOptions = {
  cellSize: number
  showGrid: boolean
  showCodes: boolean
  background?: string
}

export function drawPattern(
  canvas: HTMLCanvasElement,
  pattern: BeadPattern,
  options: DrawOptions,
) {
  const { cellSize, showGrid, showCodes, background = '#ffffff' } = options
  const dpr = window.devicePixelRatio || 1
  const logicalWidth = pattern.width * cellSize
  const logicalHeight = pattern.height * cellSize

  canvas.width = logicalWidth * dpr
  canvas.height = logicalHeight * dpr
  canvas.style.width = `${logicalWidth}px`
  canvas.style.height = `${logicalHeight}px`

  const context = canvas.getContext('2d')
  if (!context) return
  context.scale(dpr, dpr)
  context.fillStyle = background
  context.fillRect(0, 0, logicalWidth, logicalHeight)

  pattern.cells.forEach((bead, index) => {
    const x = (index % pattern.width) * cellSize
    const y = Math.floor(index / pattern.width) * cellSize
    context.fillStyle = bead.hex
    context.fillRect(x, y, cellSize, cellSize)

    if (showGrid && cellSize >= 7) {
      context.strokeStyle = 'rgba(31, 35, 34, 0.2)'
      context.lineWidth = 0.5
      context.strokeRect(x, y, cellSize, cellSize)
    }

    if (showCodes && cellSize >= 18) {
      const brightness = bead.rgb[0] * 0.299 + bead.rgb[1] * 0.587 + bead.rgb[2] * 0.114
      context.fillStyle = brightness > 155 ? '#202322' : '#ffffff'
      context.font = `600 ${Math.max(7, cellSize * 0.32)}px system-ui, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(bead.code, x + cellSize / 2, y + cellSize / 2)
    }
  })
}

export function exportPattern(pattern: BeadPattern, showCodes: boolean) {
  const canvas = document.createElement('canvas')
  const cellSize = showCodes ? 36 : 20
  drawPattern(canvas, pattern, { cellSize, showGrid: true, showCodes })
  canvas.toBlob((blob) => {
    if (!blob) return
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `pindou-${pattern.width}x${pattern.height}.png`
    link.click()
    URL.revokeObjectURL(link.href)
  }, 'image/png')
}
