import type { EntryRow } from './types'

// 工艺用水监测的领域规则：总有机碳归一化、必填项校验、导出判定。
// 列表、详情、导出、变更控制台账同步都从这里取值，保证多处读到的是同一套。

export const WATER_KEY = 'watermonitor'

/** 能推得动导出的岗位：只有本岗位的检验人可以导出。 */
export const WATER_EXPORT_POST = '水质检验员'

/** 导出前必须写全的实测项。 */
export const REQUIRED_FIELDS = ['取样点', '电导率', '总有机碳'] as const

/** 随记录持久化的导出/同步台账字段。 */
export const LEDGER_FIELDS = ['导出批次', '导出时间', '结论同步'] as const

// 总有机碳统一折算成 mg/L 保存：多处取到的值属于同一套，不许各写各的。
const TOC_UNIT_TO_MG_L: Record<string, number> = {
  'mg/l': 1,
  ppm: 1,
  'µg/l': 0.001,
  'μg/l': 0.001,
  'ug/l': 0.001,
  ppb: 0.001,
}

/** 药典工艺用水总有机碳量级远低于 100 mg/L，超过视为无效填写。 */
const TOC_MAX_MG_L = 100

export type TocParse = { ok: true; mgPerL: number; text: string } | { ok: false }

export function formatToc(mgPerL: number): string {
  return `${mgPerL.toFixed(3)} mg/L`
}

/**
 * 解析总有机碳：接受「0.5」「0.5 mg/L」「500 µg/L」「500ppb」等写法，
 * 返回归一化后的 mg/L 数值与规范文本；无法解析或超范围时判定无效。
 */
export function parseToc(raw: unknown): TocParse {
  const text = String(raw ?? '').trim()
  if (!text) {
    return { ok: false }
  }
  const match = text.match(/^([+-]?\d+(?:\.\d+)?)\s*([a-zµμ/]+)?$/i)
  if (!match) {
    return { ok: false }
  }
  const value = Number(match[1])
  if (!Number.isFinite(value)) {
    return { ok: false }
  }
  const unit = (match[2] ?? '').toLowerCase()
  const factor = unit === '' ? 1 : TOC_UNIT_TO_MG_L[unit]
  if (factor === undefined) {
    return { ok: false }
  }
  const mgPerL = value * factor
  if (mgPerL < 0 || mgPerL > TOC_MAX_MG_L) {
    return { ok: false }
  }
  return { ok: true, mgPerL, text: formatToc(mgPerL) }
}

/** 读取记录里归一化后的总有机碳文本；所有展示与导出统一走这里。 */
export function canonicalToc(row: EntryRow): string {
  const parsed = parseToc(row['总有机碳'])
  return parsed.ok ? parsed.text : ''
}

export type RowGap = { field: string; reason: string }

/** 校验一条水质监测记录还缺哪些实测项：缺项的记录导出时拦下补齐。 */
export function findRowGaps(row: EntryRow): RowGap[] {
  const gaps: RowGap[] = []
  if (!String(row['取样点'] ?? '').trim()) {
    gaps.push({ field: '取样点', reason: '取样点为空' })
  }
  if (!String(row['电导率'] ?? '').trim()) {
    gaps.push({ field: '电导率', reason: '电导率为空' })
  }
  const tocRaw = String(row['总有机碳'] ?? '').trim()
  if (!tocRaw) {
    gaps.push({ field: '总有机碳', reason: '总有机碳为空' })
  } else if (!parseToc(tocRaw).ok) {
    gaps.push({ field: '总有机碳', reason: `总有机碳「${tocRaw}」不是有效数值` })
  }
  return gaps
}

export function isRowComplete(row: EntryRow): boolean {
  return findRowGaps(row).length === 0
}

export function isRowExported(row: EntryRow): boolean {
  return String(row['导出批次'] ?? '').trim() !== ''
}

/**
 * 把记录归一化后写回：能解析的总有机碳统一成规范文本，台账字段补空值。
 * 解析不了的旧值原样保留，留给「拦下补齐」流程处理，不静默丢数据。
 */
export function normalizeWaterRow(row: EntryRow): { row: EntryRow; changed: boolean } {
  const next: EntryRow = { ...row }
  let changed = false
  const parsed = parseToc(next['总有机碳'])
  if (parsed.ok && String(next['总有机碳']) !== parsed.text) {
    next['总有机碳'] = parsed.text
    changed = true
  }
  for (const field of LEDGER_FIELDS) {
    if (next[field] === undefined) {
      next[field] = ''
      changed = true
    }
  }
  return { row: next, changed }
}
