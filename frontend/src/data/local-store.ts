import { MODULES } from './modules'
import { SEED_ROWS } from './seed'
import type { EntryRow, ModuleMeta } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pharma-cleanroom:entries'
const VERSION_KEY = 'pharma-cleanroom:entries:version'
// 版本 2：水质监测记录新增「结论」等字段，存量数据按旧记录自己的状态回填。
const STORAGE_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 结论回填：旧记录没有结论字段，按它当前状态反查动作结论；没走到判定的一律「未判定」。 */
function backfillConclusion(meta: ModuleMeta, row: EntryRow): string {
  for (const [action, conclusion] of Object.entries(meta.actionConclusions ?? {})) {
    if (meta.actionTargets[action] === row.status) {
      return conclusion
    }
  }
  return '未判定'
}

/** 逐条规整存量记录：补齐后加的字段，缺省值从旧记录自身推出来。 */
function normalizeRow(meta: ModuleMeta, row: EntryRow, index: number): EntryRow {
  const next: EntryRow = {
    ...row,
    id: Number(row.id ?? index + 1),
    status: String(row.status ?? meta.statuses[0]),
    pending: Boolean(row.pending ?? true),
    abnormal: Boolean(row.abnormal ?? false),
  }
  for (const field of meta.fields) {
    if (next[field] === undefined || next[field] === null) {
      next[field] = ''
    }
  }
  if (meta.conclusionField && next[meta.conclusionField] === undefined) {
    next[meta.conclusionField] = backfillConclusion(meta, next)
  }
  return next
}

/** v1 → v2 迁移：按模块元数据把存量记录补齐到新结构。 */
function migrate(rows: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const next: Record<string, EntryRow[]> = {}
  for (const meta of MODULES) {
    const list = rows[meta.key] ?? clone(SEED_ROWS[meta.key] ?? [])
    next[meta.key] = list.map((row, index) => normalizeRow(meta, row, index))
  }
  return next
}

function persist(rows: Record<string, EntryRow[]>): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  window.localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION))
}

function readStorage(): Record<string, EntryRow[]> {
  const seed = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return migrate(seed)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const migrated = migrate(seed)
    persist(migrated)
    return migrated
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = { ...seed, ...parsed }
    const version = Number(window.localStorage.getItem(VERSION_KEY) ?? '1')
    if (version >= STORAGE_VERSION) {
      return merged
    }
    const migrated = migrate(merged)
    persist(migrated)
    return migrated
  } catch {
    const migrated = migrate(seed)
    persist(migrated)
    return migrated
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const meta = MODULES.find((item) => item.key === key)
  const seeded = clone(SEED_ROWS[key] ?? [])
  const rows = meta ? seeded.map((row, index) => normalizeRow(meta, row, index)) : seeded
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
