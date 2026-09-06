import type { InventoryImportItem } from './types'

export const MAX_INVENTORY_CSV_BYTES = 1024 * 1024
export const MAX_INVENTORY_CSV_ITEMS = 291

export type InventoryCsvResult = {
  items: InventoryImportItem[]
  emptyCellCount: number
  errors: string[]
}

type CsvRowsResult =
  | { ok: true; rows: string[][] }
  | { ok: false; message: string }

function parseCsvRows(source: string): CsvRowsResult {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let afterQuote = false
  let line = 1

  const pushField = () => {
    row.push(field)
    field = ''
    afterQuote = false
  }

  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
          afterQuote = true
        }
      } else {
        field += char
        if (char === '\n') line += 1
        if (char === '\r' && text[index + 1] !== '\n') line += 1
      }
      continue
    }

    if (afterQuote) {
      if (char === ' ' || char === '\t') continue
      if (char === ',') {
        pushField()
        continue
      }
      if (char === '\r' || char === '\n') {
        pushRow()
        if (char === '\r' && text[index + 1] === '\n') index += 1
        line += 1
        continue
      }
      return { ok: false, message: `CSV 第 ${line} 行的引号字段后存在无效字符` }
    }

    if (char === '"') {
      if (field.length > 0) {
        return { ok: false, message: `CSV 第 ${line} 行的引号位置无效` }
      }
      inQuotes = true
      continue
    }
    if (char === ',') {
      pushField()
      continue
    }
    if (char === '\r' || char === '\n') {
      pushRow()
      if (char === '\r' && text[index + 1] === '\n') index += 1
      line += 1
      continue
    }
    field += char
  }

  if (inQuotes) {
    return { ok: false, message: `CSV 第 ${line} 行存在未闭合的引号` }
  }
  if (row.length > 0 || field.length > 0 || afterQuote) pushRow()
  return { ok: true, rows }
}

/** Parse the inventory spreadsheet matrix locally; no file bytes leave the browser. */
export function parseInventoryCsv(
  source: string,
  validCodes: ReadonlySet<string>,
): InventoryCsvResult {
  if (new TextEncoder().encode(source).byteLength > MAX_INVENTORY_CSV_BYTES) {
    return { items: [], emptyCellCount: 0, errors: ['CSV 文件不能超过 1 MiB'] }
  }

  const parsed = parseCsvRows(source)
  if (!parsed.ok) {
    return { items: [], emptyCellCount: 0, errors: [parsed.message] }
  }

  const rows = parsed.rows
    .map((cells, index) => ({ cells, line: index + 1 }))
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ''))

  if (rows.length === 0) {
    return { items: [], emptyCellCount: 0, errors: ['CSV 文件为空'] }
  }

  const errors: string[] = []
  const header = rows[0]
  if (!header || header.cells[0]?.trim() !== '系列') {
    errors.push('CSV 第一行第一列必须是“系列”')
  }

  const suffixes: string[] = []
  const seenSuffixes = new Set<string>()
  for (let column = 1; column < (header?.cells.length ?? 0); column += 1) {
    const raw = header?.cells[column]?.trim() ?? ''
    const numeric = Number(raw)
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(numeric) || numeric <= 0) {
      errors.push(`CSV 第 ${header?.line ?? 1} 行第 ${column + 1} 列必须是正整数色号后缀`)
      suffixes.push('')
      continue
    }
    const suffix = String(numeric)
    if (seenSuffixes.has(suffix)) {
      errors.push(`CSV 第 ${header?.line ?? 1} 行存在重复列“${raw}”`)
    }
    seenSuffixes.add(suffix)
    suffixes.push(suffix)
  }
  if (suffixes.length === 0) errors.push('CSV 表头至少需要一个数字列')

  const items: InventoryImportItem[] = []
  const seenSeries = new Set<string>()
  let emptyCellCount = 0

  for (const rowInfo of rows.slice(1)) {
    const { cells, line } = rowInfo
    const series = (cells[0]?.trim() ?? '').toUpperCase()
    if (!/^[A-Z]+$/.test(series)) {
      errors.push(`CSV 第 ${line} 行第一列必须是英文字母系列`)
      continue
    }
    if (seenSeries.has(series)) {
      errors.push(`CSV 第 ${line} 行存在重复系列“${series}”`)
      continue
    }
    seenSeries.add(series)

    const extras = cells.slice(suffixes.length + 1)
    if (extras.some((cell) => cell.trim() !== '')) {
      errors.push(`CSV 第 ${line} 行包含表头之外的非空单元格`)
    }

    for (let column = 0; column < suffixes.length; column += 1) {
      const raw = cells[column + 1]?.trim() ?? ''
      if (!raw) {
        emptyCellCount += 1
        continue
      }

      const suffix = suffixes[column]
      if (!suffix) continue
      const code = `${series}${suffix}`
      if (!validCodes.has(code)) {
        errors.push(`CSV 第 ${line} 行第 ${column + 2} 列对应未知色号 ${code}`)
        continue
      }
      if (!/^\d+$/.test(raw)) {
        errors.push(`CSV 第 ${line} 行第 ${column + 2} 列库存必须是非负整数`)
        continue
      }
      const quantity = Number(raw)
      if (!Number.isSafeInteger(quantity) || quantity < 0) {
        errors.push(`CSV 第 ${line} 行第 ${column + 2} 列库存必须是非负整数`)
        continue
      }
      items.push({ code, quantity })
    }
  }

  if (rows.length === 1) errors.push('CSV 至少需要一行系列数据')
  if (items.length === 0 && errors.length === 0) errors.push('CSV 没有可导入的库存数量')
  if (items.length > MAX_INVENTORY_CSV_ITEMS) {
    errors.push(`CSV 最多只能导入 ${MAX_INVENTORY_CSV_ITEMS} 个色号`)
  }

  return { items, emptyCellCount, errors }
}
