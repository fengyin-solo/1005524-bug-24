import { beforeEach, describe, expect, it } from 'vitest'

import {
  exportWaterBatch,
  getEntry,
  listEntries,
  runAction,
  saveWaterEntry,
} from './local-service'
import { listRows, resetRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 种子数据：1/2/3 完整，4 缺取样点等实测项，5 总有机碳填成「N/A」。
beforeEach(() => {
  resetRows('watermonitor')
  resetRows('changecontrol')
})

describe('状态一节一节推进，越级挡回', () => {
  it('待取样只能提交检测，直接判定合格被挡回', () => {
    expect(runAction('watermonitor', 1, '提交检测').ok).toBe(true)
    resetRows('watermonitor')
    const skipped = runAction('watermonitor', 1, '判定合格')
    expect(skipped.ok).toBe(false)
    expect(skipped.message).toContain('一节一节推进')
    expect(String(listRows('watermonitor')[0].status)).toBe('待取样')
  })

  it('检测中才能判定合格或标记不合格，终态不再接受动作', () => {
    expect(runAction('watermonitor', 2, '判定合格').ok).toBe(true)
    expect(String(listRows('watermonitor')[1].status)).toBe('已合格')
    const again = runAction('watermonitor', 2, '标记不合格')
    expect(again.ok).toBe(false)
  })

  it('其它模块同样按节推进：待评估不能直接批准变更', () => {
    resetRows('changecontrol')
    const result = runAction('changecontrol', 1, '批准变更')
    expect(result.ok).toBe(false)
    expect(runAction('changecontrol', 1, '提交评估').ok).toBe(true)
    expect(runAction('changecontrol', 1, '批准变更').ok).toBe(true)
  })
})

describe('结论同步到变更控制的台账', () => {
  it('判定合格后台账多出一条 WATER 编号记录，内容取自同一套数据', () => {
    expect(runAction('watermonitor', 2, '判定合格').ok).toBe(true)
    const ledger = listRows('changecontrol').find((row) => row['变更编号'] === 'WATER-0002')
    expect(ledger).toBeTruthy()
    expect(String(ledger?.['变更内容'])).toContain('注射用水储罐回水口')
    expect(String(ledger?.['变更内容'])).toContain('0.285 mg/L')
    expect(String(ledger?.['变更类别'])).toBe('水质监测结论同步')
    const water = getEntry('watermonitor', 2)
    expect(water?.['结论同步']).toBe('已同步')
  })

  it('同一条记录的结论在台账里只算一笔', () => {
    runAction('watermonitor', 2, '判定合格')
    const before = listRows('changecontrol').length
    // 终态后再判定会被流转挡回，台账不会重复登记。
    runAction('watermonitor', 2, '判定合格')
    expect(listRows('changecontrol').length).toBe(before)
    expect(listRows('changecontrol').filter((row) => row['变更编号'] === 'WATER-0002')).toHaveLength(1)
  })
})

describe('登记与补齐：总有机碳无效值拦下', () => {
  it('必填项没写全不让保存', () => {
    const result = saveWaterEntry({ 取样点: '', 电导率: '1.2 µS/cm', 总有机碳: '0.3' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('取样点')
  })

  it('总有机碳填成无效值拦下补齐', () => {
    const result = saveWaterEntry({ 取样点: 'A 点', 电导率: '1.2 µS/cm', 总有机碳: 'N/A' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('总有机碳')
  })

  it('合法值归一化后保存，多处读到同一套', () => {
    const result = saveWaterEntry({
      取样点: '纯化水使用点 U-20',
      水系统类别: '纯化水',
      电导率: '1.0 µS/cm',
      总有机碳: '480 µg/L',
      取样日期: '2026-10-03',
      检验人: '李检验',
    })
    expect(result.ok).toBe(true)
    expect(result.row?.['总有机碳']).toBe('0.480 mg/L')
    const id = Number(result.row?.id)
    const fromList = listEntries('watermonitor').items.find((row) => Number(row.id) === id)
    const fromDetail = getEntry('watermonitor', id)
    expect(fromDetail?.['总有机碳']).toBe('0.480 mg/L')
    expect(fromList?.['总有机碳']).toBe(fromDetail?.['总有机碳'])
  })

  it('补齐缺项记录后完整性恢复', () => {
    const fixed = saveWaterEntry(
      { 取样点: '纯化水使用点 U-09', 电导率: '1.3 µS/cm', 总有机碳: '0.41', 取样日期: '2026-09-04', 检验人: '李检验' },
      4,
    )
    expect(fixed.ok).toBe(true)
    expect(fixed.row?.['总有机碳']).toBe('0.410 mg/L')
  })
})

describe('整包导出', () => {
  it('只有本岗位的检验人推得动导出，越权拒绝', () => {
    const denied = exportWaterBatch('值班管理员')
    expect(denied.ok).toBe(false)
    expect(denied.kind).toBe('denied')
    expect(denied.message).toContain('水质检验员')
    expect(denied.content).toBeUndefined()
  })

  it('缺项记录拦下不报整包错，能导的一次导完不出半截文件', () => {
    const outcome = exportWaterBatch('水质检验员')
    expect(outcome.ok).toBe(true)
    expect(outcome.exportedIds).toEqual([1, 2, 3])
    expect(outcome.blocked.map((item) => item.id)).toEqual([4, 5])
    const lines = String(outcome.content).split('\n')
    expect(lines).toHaveLength(1 + 3)
    expect(outcome.content).toContain('0.320 mg/L')
    expect(outcome.content).not.toContain('N/A')
    // 落台账：已导出的记录带上批次号。
    expect(String(getEntry('watermonitor', 1)?.['导出批次'])).toBe(outcome.filename?.match(/WEXP-\d+-\d+/)?.[0] ?? '')
  })

  it('同一条取样记录重复导出只算一次', () => {
    const first = exportWaterBatch('水质检验员')
    expect(first.exportedIds).toHaveLength(3)
    const second = exportWaterBatch('水质检验员')
    expect(second.ok).toBe(false)
    // 已导出的 1/2/3 不再进任何新文件；剩下的只有待补齐的 4/5。
    expect(second.content).toBeUndefined()
    expect(second.exportedIds).toEqual([])
    expect(second.blocked.map((item) => item.id)).toEqual([4, 5])
  })

  it('失败重试把没成功的那几笔补上，已导出的不丢不重复', () => {
    const first = exportWaterBatch('水质检验员')
    expect(first.blocked.map((item) => item.id)).toEqual([4, 5])
    saveWaterEntry({ 取样点: '纯化水使用点 U-09', 电导率: '1.3 µS/cm', 总有机碳: '0.41' }, 4)
    saveWaterEntry({ 取样点: '纯化水使用点 U-12', 电导率: '1.4 µS/cm', 总有机碳: '0.38' }, 5)
    const retry = exportWaterBatch('水质检验员')
    expect(retry.ok).toBe(true)
    expect(retry.exportedIds).toEqual([4, 5])
    expect(retry.content).not.toContain('纯化水机 RO 出水口')
    // 之前导出的 1/2/3 还挂在台账上。
    expect(String(getEntry('watermonitor', 1)?.['导出批次'])).not.toBe('')
  })

  it('没有可导记录时给空态说明，不出空文件', () => {
    saveRows('watermonitor', [])
    const outcome = exportWaterBatch('水质检验员')
    expect(outcome.ok).toBe(false)
    expect(outcome.kind).toBe('empty')
    expect(outcome.message).toContain('暂无水质监测记录')
    expect(outcome.content).toBeUndefined()
  })

  it('全部缺项时整包拦下并逐条说明，不堆半截文件', () => {
    const broken: EntryRow[] = [
      { id: 1, status: '待取样', pending: true, abnormal: false, 取样点: '', 电导率: '', 总有机碳: '', 导出批次: '', 导出时间: '', 结论同步: '' },
    ]
    saveRows('watermonitor', broken)
    const outcome = exportWaterBatch('水质检验员')
    expect(outcome.ok).toBe(false)
    expect(outcome.kind).toBe('blocked')
    expect(outcome.content).toBeUndefined()
    expect(outcome.blocked[0].gaps.map((gap) => gap.field)).toEqual(['取样点', '电导率', '总有机碳'])
  })
})
