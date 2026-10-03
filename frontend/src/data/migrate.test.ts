import { describe, expect, it } from 'vitest'

import { migrateEntries } from './migrate'
import type { EntryRow } from './types'

function oldRow(patch: Partial<EntryRow>): EntryRow {
  // 模拟老版本存下来的记录：没有导出/同步台账字段，总有机碳写法五花八门。
  return { id: 1, status: '待取样', pending: true, abnormal: false, ...patch }
}

describe('migrateEntries 存量数据迁移', () => {
  it('按旧记录回填：归一总有机碳、补齐台账字段与缺列', () => {
    const legacy = oldRow({
      取样点: '纯化水机 RO 出水口',
      电导率: '1.2 µS/cm',
      总有机碳: '500 µg/L',
      取样日期: '2026-09-01',
    })
    const { data, changed } = migrateEntries({ watermonitor: [legacy] })
    expect(changed).toBe(true)
    const migrated = data.watermonitor[0]
    expect(migrated['总有机碳']).toBe('0.500 mg/L')
    expect(migrated['导出批次']).toBe('')
    expect(migrated['导出时间']).toBe('')
    expect(migrated['结论同步']).toBe('')
    expect(migrated['微生物限度']).toBe('')
    expect(migrated['取样点']).toBe('纯化水机 RO 出水口')
  })

  it('无效旧值原样保留，留给拦下补齐流程', () => {
    const legacy = oldRow({ 取样点: 'A 点', 电导率: '1.2', 总有机碳: '工艺用水监测样例1' })
    const { data } = migrateEntries({ watermonitor: [legacy] })
    expect(data.watermonitor[0]['总有机碳']).toBe('工艺用水监测样例1')
  })

  it('迁移幂等：再跑一遍不再改动', () => {
    const legacy = oldRow({ 取样点: 'A 点', 电导率: '1.2', 总有机碳: '0.5' })
    const once = migrateEntries({ watermonitor: [legacy] })
    const twice = migrateEntries(once.data)
    expect(once.changed).toBe(true)
    expect(twice.changed).toBe(false)
  })

  it('没有水质监测数据时不动作', () => {
    const { changed } = migrateEntries({})
    expect(changed).toBe(false)
  })
})
