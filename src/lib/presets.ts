export type ImageAdjustments = {
  brightness: number
  contrast: number
  saturation: number
}

export type ImagePreset = ImageAdjustments & {
  id: string
  name: string
}

export const NEUTRAL_PRESET: ImagePreset = {
  id: 'neutral',
  name: '原图',
  brightness: 0,
  contrast: 0,
  saturation: 0,
}

export const IMAGE_PRESETS: Record<string, ImagePreset> = {
  photo: { id: 'photo', name: '照片', brightness: 0, contrast: 10, saturation: 10 },
  avatar: { id: 'avatar', name: '头像', brightness: 10, contrast: 15, saturation: 20 },
  cartoon: { id: 'cartoon', name: '卡通', brightness: 5, contrast: 25, saturation: 30 },
  logo: { id: 'logo', name: 'Logo', brightness: 0, contrast: 40, saturation: 0 },
}

export const ALL_IMAGE_PRESETS: ImagePreset[] = [NEUTRAL_PRESET, ...Object.values(IMAGE_PRESETS)]

export function matchImagePreset(adjustments: ImageAdjustments): string | null {
  for (const preset of ALL_IMAGE_PRESETS) {
    if (
      preset.brightness === adjustments.brightness &&
      preset.contrast === adjustments.contrast &&
      preset.saturation === adjustments.saturation
    ) {
      return preset.id
    }
  }
  return null
}
