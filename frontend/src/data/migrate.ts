import { MODULE_BY_KEY } from './modules'
import type { EntryRow } from './types'
import { normalizeWaterRow, WATER_KEY } from './waterquality'

// 存量数据迁移：老版本浏览器里已经存了记录的，按旧记录回填新字段。
// 目前只做工艺用水监测：总有机碳归一化、导出/同步台账字段补齐、缺列补空串。
// 迁移是幂等的，每次读存储都过一遍，只有真的改了才回写。

function migrateWaterRows(rows: EntryRow[]): { rows: EntryRow[]; changed: boolean } {
  const meta = MODULE_BY_KEY.get(WATER_KEY)
  let changed = false
  const migrated = rows.map((row) => {
    let current = row
    for (const field of meta?.fields ?? []) {
      if (current[field] === undefined) {
        if (current === row) {
          current = { ...row }
        }
        current[field] = ''
        changed = true
      }
    }
    const normalized = normalizeWaterRow(current)
    if (normalized.changed) {
      changed = true
      current = normalized.row
    }
    return current
  })
  return { rows: migrated, changed }
}

export function migrateEntries(data: Record<string, EntryRow[]>): {
  data: Record<string, EntryRow[]>
  changed: boolean
} {
  const water = data[WATER_KEY]
  if (!Array.isArray(water)) {
    return { data, changed: false }
  }
  const migrated = migrateWaterRows(water)
  if (!migrated.changed) {
    return { data, changed: false }
  }
  return { data: { ...data, [WATER_KEY]: migrated.rows }, changed: true }
}
