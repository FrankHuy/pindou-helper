export type BeadColor = {
  code: string
  name: string
  hex: string
  rgb: [number, number, number]
}

const color = (code: string, name: string, hex: string): BeadColor => {
  const value = hex.replace('#', '')
  return {
    code,
    name,
    hex,
    rgb: [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ],
  }
}

// MARD basic palette for MVP validation. The palette is isolated here so the
// complete, verified manufacturer chart can replace it without touching logic.
export const MARD_PALETTE: BeadColor[] = [
  color('A1', '白色', '#F7F7F2'),
  color('A2', '奶白', '#EEE9D8'),
  color('A3', '浅灰', '#C9CBC8'),
  color('A4', '中灰', '#8D9291'),
  color('A5', '深灰', '#535858'),
  color('A6', '黑色', '#242526'),
  color('B1', '柠檬黄', '#F6DF38'),
  color('B2', '亮黄', '#F3C52B'),
  color('B3', '橙黄', '#EEA23A'),
  color('B4', '橙色', '#E97834'),
  color('B5', '深橙', '#D9582F'),
  color('C1', '浅粉', '#F5C9CD'),
  color('C2', '粉色', '#ED9EAD'),
  color('C3', '珊瑚粉', '#E77F83'),
  color('C4', '红色', '#CE4847'),
  color('C5', '深红', '#963C43'),
  color('D1', '淡紫', '#D3C0DE'),
  color('D2', '紫色', '#A985BD'),
  color('D3', '深紫', '#735488'),
  color('E1', '天蓝', '#A7D4E2'),
  color('E2', '浅蓝', '#70B8D0'),
  color('E3', '蓝色', '#408DBA'),
  color('E4', '深蓝', '#315C8B'),
  color('E5', '藏蓝', '#293E62'),
  color('F1', '薄荷绿', '#B7DDBE'),
  color('F2', '草绿', '#79B873'),
  color('F3', '绿色', '#448B62'),
  color('F4', '深绿', '#32604D'),
  color('G1', '肤色', '#EDC4A5'),
  color('G2', '浅棕', '#C9956D'),
  color('G3', '棕色', '#93654E'),
  color('G4', '深棕', '#60473F'),
]
