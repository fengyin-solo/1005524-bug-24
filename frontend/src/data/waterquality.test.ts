import { describe, expect, it } from 'vitest'

import type { EntryRow } from './types'
import { findRowGaps, isRowExported, normalizeWaterRow, parseToc } from './waterquality'

function row(patch: Partial<EntryRow>): EntryRow {
  return { id: 1, status: '待取样', pending: true, abnormal: false, ...patch }
}

describe('parseToc 总有机碳归一化', () => {
  it('接受纯数字并按 mg/L 归一', () => {
    expect(parseToc('0.5')).toEqual({ ok: true, mgPerL: 0.5, text: '0.500 mg/L' })
  })

  it('把 µg/L、ppb 等不同取法折算进同一套 mg/L', () => {
    expect(parseToc('500 µg/L')).toEqual({ ok: true, mgPerL: 0.5, text: '0.500 mg/L' })
    expect(parseToc('500μg/l')).toEqual({ ok: true, mgPerL: 0.5, text: '0.500 mg/L' })
    expect(parseToc('500ppb')).toEqual({ ok: true, mgPerL: 0.5, text: '0.500 mg/L' })
    expect(parseToc('320 ug/L')).toEqual({ ok: true, mgPerL: 0.32, text: '0.320 mg/L' })
    expect(parseToc('1 ppm')).toEqual({ ok: true, mgPerL: 1, text: '1.000 mg/L' })
    expect(parseToc('0.320 mg/L')).toEqual({ ok: true, mgPerL: 0.32, text: '0.320 mg/L' })
  })

  it('无效值拦下：空串、文字、负数、超范围、畸形数字', () => {
    for (const bad of ['', 'N/A', '未检出', '-1', '200', '0.5.2', 'abc', '12 瓶']) {
      expect(parseToc(bad).ok, `「${bad}」应判无效`).toBe(false)
    }
  })
})

describe('findRowGaps 实测缺项校验', () => {
  it('取样点、电导率、总有机碳写全才算完整', () => {
    const gaps = findRowGaps(row({ 取样点: '', 电导率: '', 总有机碳: '' }))
    expect(gaps.map((gap) => gap.field)).toEqual(['取样点', '电导率', '总有机碳'])
  })

  it('总有机碳填成无效值也算缺项并说明原因', () => {
    const gaps = findRowGaps(row({ 取样点: 'A 点', 电导率: '1.2 µS/cm', 总有机碳: 'N/A' }))
    expect(gaps).toHaveLength(1)
    expect(gaps[0].field).toBe('总有机碳')
    expect(gaps[0].reason).toContain('不是有效数值')
  })

  it('完整记录没有缺项', () => {
    expect(findRowGaps(row({ 取样点: 'A 点', 电导率: '1.2 µS/cm', 总有机碳: '0.320 mg/L' }))).toHaveLength(0)
  })
})

describe('normalizeWaterRow 按旧记录回填', () => {
  it('能解析的总有机碳归一成规范文本，台账字段补空串', () => {
    const { row: next, changed } = normalizeWaterRow(row({ 总有机碳: '0.5' }))
    expect(changed).toBe(true)
    expect(next['总有机碳']).toBe('0.500 mg/L')
    expect(next['导出批次']).toBe('')
    expect(next['导出时间']).toBe('')
    expect(next['结论同步']).toBe('')
  })

  it('解析不了的旧值原样保留，不静默丢数据', () => {
    const { row: next } = normalizeWaterRow(row({ 总有机碳: '工艺用水监测样例1', 导出批次: '', 导出时间: '', 结论同步: '' }))
    expect(next['总有机碳']).toBe('工艺用水监测样例1')
  })

  it('已规范的记录不再改动（幂等）', () => {
    const source = row({ 总有机碳: '0.500 mg/L', 导出批次: '', 导出时间: '', 结论同步: '' })
    expect(normalizeWaterRow(source).changed).toBe(false)
  })
})

describe('isRowExported 导出台账', () => {
  it('有导出批次才算已导出', () => {
    expect(isRowExported(row({ 导出批次: '' }))).toBe(false)
    expect(isRowExported(row({ 导出批次: 'WEXP-20261003-001' }))).toBe(true)
  })
})
