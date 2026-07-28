import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PublicUser } from '../auth/authApi'
import {
  ALL_SERIES,
  MARD_COLORS,
  MARD_PACK_SIZES,
  resolvePalette,
} from '../../lib/palettes'
import type { BeadColor, MerchantPackSize, PaletteRange } from '../../lib/palettes'
import type {
  InventorySnapshot,
  InventoryEntryUnit,
  InventoryEntryItem,
  LedgerEntry,
  LedgerResponse,
} from '../../lib/inventory/types'
import {
  totalBeads,
  touchedCount,
  lowStockCount,
  recordsToMap,
} from '../../lib/inventory/math'
import {
  postEntries,
  setCodeQuantity,
  updateLowStockThreshold,
  fetchLedger,
  InventoryRequestError,
} from './inventoryApi'
import './inventory.css'

const RANGE_OPTIONS: { id: PaletteRange; label: string; count: number }[] = [
  { id: 'full', label: '完整', count: 291 },
  { id: 'standard', label: '标准', count: 221 },
  { id: 'extended', label: '扩展', count: 70 },
]

const REASON_LABELS: Record<LedgerEntry['reason'], string> = {
  entry: '录入',
  set: '校正',
  deduct: '扣减',
  adjust: '调整',
}

const LEDGER_PAGE_SIZE = 50

type InventoryTabProps = {
  sessionUser: PublicUser | null
  inventory: InventorySnapshot | null
  inventoryLoading: boolean
  inventoryError: string
  onLogin: () => void
  onRefresh: () => void
  onMutated: (snapshot: InventorySnapshot) => void
}

/** Parse a color code into series letter and numeric suffix. */
function parseCode(code: string): { series: string; number: string } {
  const match = code.match(/^([A-Z]+)(\d+)$/)
  if (match) return { series: match[1], number: match[2] }
  return { series: code, number: '' }
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${min}`
}

export default function InventoryTab({
  sessionUser,
  inventory,
  inventoryLoading,
  inventoryError,
  onLogin,
  onRefresh,
  onMutated,
}: InventoryTabProps) {
  // --- Scope selection ---
  const [range, setRange] = useState<PaletteRange>('full')
  const [merchantPack, setMerchantPack] = useState<MerchantPackSize>(null)

  // --- Entry unit ---
  const [unit, setUnit] = useState<InventoryEntryUnit>('bead')

  // --- Draft entries: code → string input value ---
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  // --- Submit state ---
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // --- Correction inputs: code → string ---
  const [corrections, setCorrections] = useState<Record<string, string>>({})

  // --- Threshold input ---
  const [thresholdInput, setThresholdInput] = useState('')

  // --- Filters ---
  const [filterLowStock, setFilterLowStock] = useState(false)
  const [filterSeries, setFilterSeries] = useState<string | null>(null)

  // --- Ledger ---
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([])
  const [ledgerCursor, setLedgerCursor] = useState<number | null>(null)

  const successTimer = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (successTimer.current != null) window.clearTimeout(successTimer.current)
    }
  }, [])

  const showSuccess = useCallback((msg: string) => {
    setSuccessMsg(msg)
    if (successTimer.current != null) window.clearTimeout(successTimer.current)
    successTimer.current = window.setTimeout(() => setSuccessMsg(''), 3000)
  }, [])

  // --- Resolve palette from selection ---
  const resolved = useMemo(() => {
    return resolvePalette({
      brand: 'MARD',
      range,
      merchantPack,
      seriesFilter: null,
      disabled: new Set(),
    })
  }, [range, merchantPack])

  // --- Available series from scoped colors ---
  const availableSeries = useMemo(() => {
    const set = new Set(resolved.baseColors.map((c) => c.series))
    return ALL_SERIES.filter((s) => set.has(s))
  }, [resolved.baseColors])

  // --- Build spreadsheet grid data ---
  const gridData = useMemo(() => {
    const colors = resolved.scopedColors
    // Group by series, and collect column numbers per series
    const seriesMap = new Map<string, Map<string, BeadColor>>()
    const allNumbers = new Set<string>()
    for (const color of colors) {
      const { series, number } = parseCode(color.code)
      if (!number) continue
      if (!seriesMap.has(series)) seriesMap.set(series, new Map())
      seriesMap.get(series)!.set(number, color)
      allNumbers.add(number)
    }
    // Sort series and numbers
    const sortedSeries = [...seriesMap.keys()].sort((a, b) => a.localeCompare(b))
    const sortedNumbers = [...allNumbers].sort((a, b) => Number(a) - Number(b))
    return { seriesMap, sortedSeries, sortedNumbers }
  }, [resolved.scopedColors])

  // --- Inventory lookup map ---
  const inventoryMap = useMemo(() => {
    if (!inventory) return new Map<string, number>()
    return recordsToMap(inventory.records)
  }, [inventory])

  // --- Filtered records for correction list ---
  const filteredRecords = useMemo(() => {
    if (!inventory) return []
    let records = inventory.records.filter((r) => r.touched)
    if (filterLowStock) {
      const threshold = inventory.lowStockThreshold
      records = records.filter((r) => r.quantity < threshold)
    }
    if (filterSeries) {
      records = records.filter((r) => parseCode(r.code).series === filterSeries)
    }
    return records.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
  }, [inventory, filterLowStock, filterSeries])

  // --- Color lookup for corrections ---
  const colorByCode = useMemo(() => {
    const map = new Map<string, BeadColor>()
    for (const color of MARD_COLORS) map.set(color.code, color)
    return map
  }, [])

  // --- Handlers ---

  const handleSetRange = (next: PaletteRange) => {
    setRange(next)
    setMerchantPack(null)
  }

  const handleSetPack = (value: string) => {
    if (value === '') {
      setMerchantPack(null)
    } else {
      setMerchantPack(Number(value) as MerchantPackSize)
    }
  }

  const handleDraftChange = (code: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [code]: value }))
  }

  const handleBatchSubmit = useCallback(async () => {
    const items: InventoryEntryItem[] = []
    for (const [code, valueStr] of Object.entries(drafts)) {
      const trimmed = valueStr.trim()
      if (!trimmed) continue
      const value = Number(trimmed)
      if (!Number.isFinite(value) || value <= 0) continue
      items.push({ code, value })
    }
    if (items.length === 0) {
      setActionError('请先在表格中输入数量')
      return
    }
    setSubmitting(true)
    setActionError('')
    try {
      const snapshot = await postEntries(unit, items)
      onMutated(snapshot)
      setDrafts({})
      showSuccess(`成功录入 ${items.length} 个色号`)
    } catch (err) {
      setActionError(err instanceof InventoryRequestError ? err.message : '提交失败')
    } finally {
      setSubmitting(false)
    }
  }, [drafts, unit, onMutated, showSuccess])

  const handleCorrection = useCallback(async (code: string) => {
    const valueStr = (corrections[code] ?? '').trim()
    if (!valueStr) return
    const quantity = Number(valueStr)
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
      setActionError('库存数量必须是 ≥ 0 的整数')
      return
    }
    setSubmitting(true)
    setActionError('')
    try {
      const snapshot = await setCodeQuantity(code, quantity)
      onMutated(snapshot)
      setCorrections((prev) => {
        const next = { ...prev }
        delete next[code]
        return next
      })
      showSuccess(`色号 ${code} 已校正为 ${quantity} 颗`)
    } catch (err) {
      setActionError(err instanceof InventoryRequestError ? err.message : '校正失败')
    } finally {
      setSubmitting(false)
    }
  }, [corrections, onMutated, showSuccess])

  const handleThresholdSubmit = useCallback(async () => {
    const valueStr = thresholdInput.trim()
    if (!valueStr) return
    const threshold = Number(valueStr)
    if (!Number.isFinite(threshold) || threshold < 0 || !Number.isInteger(threshold)) {
      setActionError('阈值必须是 ≥ 0 的整数')
      return
    }
    setSubmitting(true)
    setActionError('')
    try {
      const snapshot = await updateLowStockThreshold(threshold)
      onMutated(snapshot)
      setThresholdInput('')
      showSuccess(`低库存阈值已设为 ${threshold} 颗`)
    } catch (err) {
      setActionError(err instanceof InventoryRequestError ? err.message : '设置失败')
    } finally {
      setSubmitting(false)
    }
  }, [thresholdInput, onMutated, showSuccess])

  const loadLedger = useCallback(async (cursor: number | null, reset: boolean) => {
    setLedgerLoading(true)
    try {
      const resp: LedgerResponse = await fetchLedger(LEDGER_PAGE_SIZE, cursor)
      if (reset) {
        setLedgerEntries(resp.entries)
      } else {
        setLedgerEntries((prev) => [...prev, ...resp.entries])
      }
      setLedgerCursor(resp.nextCursor)
    } catch (err) {
      setActionError(err instanceof InventoryRequestError ? err.message : '加载流水失败')
    } finally {
      setLedgerLoading(false)
    }
  }, [])

  const toggleLedger = useCallback(() => {
    const nextOpen = !ledgerOpen
    setLedgerOpen(nextOpen)
    if (nextOpen && ledgerEntries.length === 0) {
      void loadLedger(null, true)
    }
  }, [ledgerOpen, ledgerEntries.length, loadLedger])

  const unitLabel = unit === 'bead' ? '颗' : 'g'

  // --- Login gate ---
  if (!sessionUser) {
    return (
      <div className="inventory-tab">
        <div className="inventory-login-gate">
          <h2>豆子库存管理</h2>
          <p>登录后可管理你的豆子库存，支持跨设备同步。</p>
          <button type="button" onClick={onLogin}>
            登录
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="inventory-tab">
      <h2>豆子库存管理</h2>
      <p className="top-hint">登录账号绑定，跨设备同步色号库存与流水。屏幕色仅供参考。</p>

      {inventoryLoading && <div className="inventory-loading">正在加载库存…</div>}
      {inventoryError && <div className="inventory-error">{inventoryError}</div>}
      {actionError && <div className="inventory-error">{actionError}</div>}
      {successMsg && <div className="inventory-success">{successMsg}</div>}

      {/* Overview */}
      {inventory && (
        <div className="inventory-overview">
          <div className="inventory-stat">
            <div className="inventory-stat-value">{totalBeads(inventory.records)}</div>
            <div className="inventory-stat-label">总库存颗数</div>
          </div>
          <div className="inventory-stat">
            <div className="inventory-stat-value">{touchedCount(inventory.records)}</div>
            <div className="inventory-stat-label">已录入色号数</div>
          </div>
          <div className="inventory-stat">
            <div className="inventory-stat-value">{lowStockCount(inventory)}</div>
            <div className="inventory-stat-label">低库存色号数</div>
          </div>
        </div>
      )}

      {/* Scope selector */}
      <div className="inventory-scope-selector">
        <h3 className="inventory-section-heading">录入色号范围</h3>
        <div className="inventory-scope-row">
          <span className="inventory-scope-label">色号范围</span>
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`scope-chip${merchantPack == null && range === option.id ? ' active' : ''}`}
              onClick={() => handleSetRange(option.id)}
              disabled={merchantPack != null}
            >
              {option.label}({option.count})
            </button>
          ))}
        </div>
        <div className="inventory-scope-row">
          <span className="inventory-scope-label">商家套装</span>
          <select
            aria-label="商家套装"
            value={merchantPack ?? ''}
            onChange={(e) => handleSetPack(e.target.value)}
          >
            <option value="">不使用套装</option>
            {MARD_PACK_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} 色
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Unit toggle + batch submit */}
      <div className="inventory-scope-row">
        <span className="inventory-scope-label">录入单位</span>
        <div className="inventory-unit-toggle">
          <button
            type="button"
            className={unit === 'bead' ? 'active' : ''}
            onClick={() => setUnit('bead')}
          >
            颗
          </button>
          <button
            type="button"
            className={unit === 'gram' ? 'active' : ''}
            onClick={() => setUnit('gram')}
          >
            g
          </button>
        </div>
        <div className="inventory-entry-actions">
          <button
            type="button"
            className="inventory-submit"
            onClick={() => void handleBatchSubmit()}
            disabled={submitting}
          >
            {submitting ? '提交中…' : '批量录入'}
          </button>
          {Object.values(drafts).filter((v) => v.trim() !== '').length > 0 && (
            <span className="submit-count">
              已填 {Object.values(drafts).filter((v) => v.trim() !== '').length} 个
            </span>
          )}
        </div>
      </div>
      <p className="inventory-grid-hint">
        录入单位为{unitLabel}，{unit === 'gram' ? '1g = 100颗' : '直接输入颗数'}；
        批量录入为「增加」到现有库存，不会覆盖。
      </p>

      {/* Spreadsheet grid */}
      <div className="inventory-grid-wrap">
        <table className="inventory-grid">
          <thead>
            <tr>
              <th className="row-header">系列</th>
              {gridData.sortedNumbers.map((num) => (
                <th key={num}>{num}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gridData.sortedSeries.map((series) => (
              <tr key={series}>
                <td className="row-header">{series}</td>
                {gridData.sortedNumbers.map((num) => {
                  const color = gridData.seriesMap.get(series)?.get(num)
                  if (!color) return <td key={num} className="inventory-cell-hint" />
                  const balance = inventoryMap.get(color.code) ?? 0
                  return (
                    <td key={num} className="inventory-grid-cell">
                      <span className="cell-swatch" style={{ backgroundColor: color.hex }} />
                      <span className="cell-code">{color.code}</span>
                      <span className="cell-balance">{balance} 颗</span>
                      <input
                        type="number"
                        min={0}
                        step={unit === 'gram' ? 0.01 : 1}
                        placeholder={unitLabel}
                        value={drafts[color.code] ?? ''}
                        onChange={(e) => handleDraftChange(color.code, e.target.value)}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {gridData.sortedSeries.length === 0 && (
        <p className="inventory-empty">当前所选范围没有可用色号</p>
      )}

      {/* Filters for correction list */}
      <h3 className="inventory-section-heading">库存明细与校正</h3>
      <div className="inventory-filters">
        <button
          type="button"
          className={`chip-button${!filterLowStock && filterSeries == null ? ' active' : ''}`}
          onClick={() => {
            setFilterLowStock(false)
            setFilterSeries(null)
          }}
        >
          全部
        </button>
        <label className="inventory-low-stock-toggle">
          <input
            type="checkbox"
            checked={filterLowStock}
            onChange={(e) => setFilterLowStock(e.target.checked)}
          />
          <span>仅低库存</span>
        </label>
        {availableSeries.map((series) => (
          <button
            key={series}
            type="button"
            className={`chip-button${filterSeries === series ? ' active' : ''}`}
            onClick={() => setFilterSeries(filterSeries === series ? null : series)}
          >
            {series}
          </button>
        ))}
      </div>

      {/* Correction list */}
      {filteredRecords.length === 0 ? (
        <p className="inventory-empty">暂无已录入的色号</p>
      ) : (
        <div className="inventory-list">
          {filteredRecords.map((record) => {
            const color = colorByCode.get(record.code)
            const isLow = inventory != null && record.quantity < inventory.lowStockThreshold
            return (
              <div key={record.code} className="inventory-correction-row">
                {color && (
                  <span className="swatch" style={{ backgroundColor: color.hex }} />
                )}
                <span className="code">{record.code}</span>
                <span className="balance">{record.quantity} 颗</span>
                {isLow && <span className="low-badge">低库存</span>}
                <input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="校正为"
                  value={corrections[record.code] ?? ''}
                  onChange={(e) =>
                    setCorrections((prev) => ({ ...prev, [record.code]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCorrection(record.code)
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleCorrection(record.code)}
                  disabled={submitting}
                >
                  校正
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Threshold settings */}
      <div className="inventory-settings-row">
        <span className="inventory-scope-label">低库存阈值</span>
        <input
          type="number"
          min={0}
          step={1}
          placeholder={String(inventory?.lowStockThreshold ?? 100)}
          value={thresholdInput}
          onChange={(e) => setThresholdInput(e.target.value)}
        />
        <span>颗</span>
        <button
          type="button"
          className="primary"
          onClick={() => void handleThresholdSubmit()}
          disabled={submitting}
        >
          保存
        </button>
        {inventory && (
          <span className="inventory-grid-hint">当前阈值：{inventory.lowStockThreshold} 颗</span>
        )}
      </div>

      {/* Ledger */}
      <div className="inventory-ledger">
        <button
          type="button"
          className={`inventory-ledger-toggle${ledgerOpen ? ' open' : ''}`}
          onClick={toggleLedger}
        >
          <span className="arrow">▶</span>
          <span>流水记录</span>
        </button>
        {ledgerOpen && (
          <div className="inventory-ledger-content">
            {ledgerLoading && ledgerEntries.length === 0 && (
              <div className="inventory-loading">正在加载流水…</div>
            )}
            {ledgerEntries.length === 0 && !ledgerLoading && (
              <p className="inventory-empty">暂无流水记录</p>
            )}
            {ledgerEntries.map((entry) => (
              <div key={entry.id} className="inventory-ledger-entry">
                <span className="entry-code">{entry.code}</span>
                <span
                  className={`entry-delta${entry.delta > 0 ? ' positive' : ' negative'}`}
                >
                  {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                </span>
                <span className="entry-reason">{REASON_LABELS[entry.reason]}</span>
                <span className="entry-time">{formatTime(entry.createdAt)}</span>
              </div>
            ))}
            {ledgerCursor != null && (
              <button
                type="button"
                className="inventory-ledger-load-more"
                onClick={() => void loadLedger(ledgerCursor, false)}
                disabled={ledgerLoading}
              >
                {ledgerLoading ? '加载中…' : '加载更多'}
              </button>
            )}
          </div>
        )}
      </div>

      <button type="button" onClick={onRefresh} style={{ alignSelf: 'flex-start' }}>
        刷新库存
      </button>
    </div>
  )
}
