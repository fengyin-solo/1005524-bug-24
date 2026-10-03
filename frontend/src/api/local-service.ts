import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import {
  findRowGaps,
  isRowExported,
  normalizeWaterRow,
  parseToc,
  REQUIRED_FIELDS,
  WATER_KEY,
  type RowGap,
} from '@/data/waterquality'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 详情与列表读的是同一份数据，保证两处看到的值一样。 */
export function getEntry(key: string, id: number): EntryRow | null {
  const row = listRows(key).find((item) => Number(item.id) === id)
  return row ? { ...row } : null
}

/** 没有后续动作可发起的状态就是终态，终态不再计入待处理。 */
function terminalStatuses(meta: ModuleMeta): Set<string> {
  const sources = new Set(Object.values(meta.actionSources).flat())
  return new Set(meta.statuses.filter((status) => !sources.has(status)))
}

// 水质监测结论出来后，要同步进变更控制的台账；按记录编号 upsert，重复判定不会堆重复条目。
const WATER_CONCLUSION_STATUSES = ['已合格', '不合格']

function syncWaterConclusion(row: EntryRow): void {
  const rows = listRows('changecontrol')
  const code = `WATER-${String(row.id).padStart(4, '0')}`
  const content =
    `取样点「${row['取样点']}」(${row['水系统类别']}) 监测结论：${row.status}；` +
    `电导率 ${row['电导率']}；总有机碳 ${row['总有机碳']}`
  const index = rows.findIndex((item) => String(item['变更编号']) === code)
  const ledger: EntryRow = {
    id: index >= 0 ? rows[index].id : rows.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1,
    status: index >= 0 ? rows[index].status : '待评估',
    pending: index >= 0 ? Boolean(rows[index].pending) : true,
    abnormal: false,
    变更编号: code,
    变更类别: '水质监测结论同步',
    涉及工序: '工艺用水监测',
    变更内容: content,
    风险评估: '水质监测结论自动登记，按变更控制流程评估',
    审批人: String(row['检验人'] ?? ''),
    生效日期: String(row['取样日期'] ?? ''),
    变更状态: '已同步',
  }
  const next = index >= 0 ? rows.map((item, i) => (i === index ? ledger : item)) : [...rows, ledger]
  saveRows('changecontrol', next)
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 状态只能一节一节推进：当前状态不在动作允许的发起状态里，就是越级，直接挡回。
  const sources = meta.actionSources[action] ?? []
  if (!sources.includes(current)) {
    return {
      ok: false,
      message: `${meta.entity}当前状态「${current}」不能执行「${action}」，状态需一节一节推进`,
    }
  }
  const terminals = terminalStatuses(meta)
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !terminals.has(target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (key === WATER_KEY && WATER_CONCLUSION_STATUSES.includes(target)) {
    // 结论同步到变更控制的台账，并在记录上留下已同步标记。
    updated['结论同步'] = '已同步'
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  if (key === WATER_KEY && WATER_CONCLUSION_STATUSES.includes(target)) {
    syncWaterConclusion(updated)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

/**
 * 登记或补齐水质监测记录：取样点、电导率、总有机碳必须写全，
 * 总有机碳填成无效值直接拦下，补齐后才允许保存；合法值统一归一化。
 */
export function saveWaterEntry(
  input: Record<string, string>,
  id?: number,
): ActionResult & { row?: EntryRow } {
  const meta = moduleMeta(WATER_KEY)
  const rows = listRows(WATER_KEY)
  const existing = id !== undefined ? rows.find((row) => Number(row.id) === id) : undefined
  if (id !== undefined && !existing) {
    return { ok: false, message: `没有找到编号为 ${id} 的水质监测记录` }
  }
  const base: EntryRow = existing ?? {
    id: rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1,
    status: '待取样',
    pending: true,
    abnormal: false,
    导出批次: '',
    导出时间: '',
    结论同步: '',
  }
  const draft: EntryRow = { ...base }
  for (const field of meta.fields) {
    // 只覆盖表单里带过来的字段；新建时没填的一律补空串，更新时没带的保留原值。
    if (input[field] !== undefined) {
      draft[field] = String(input[field]).trim()
    } else if (!existing) {
      draft[field] = ''
    }
  }
  // 校验合并后的整行：必填项写全、总有机碳是有效值，否则拦下补齐。
  for (const field of REQUIRED_FIELDS) {
    if (!String(draft[field] ?? '').trim()) {
      return { ok: false, message: `${field}还没写全，请补齐后再保存` }
    }
  }
  const toc = parseToc(draft['总有机碳'])
  if (!toc.ok) {
    return { ok: false, message: `总有机碳「${draft['总有机碳'] ?? ''}」不是有效数值，请补齐后再保存` }
  }
  draft['总有机碳'] = toc.text
  const normalized = normalizeWaterRow(draft).row
  const index = rows.findIndex((row) => Number(row.id) === Number(normalized.id))
  const nextRows = index >= 0 ? rows.map((row, i) => (i === index ? normalized : row)) : [...rows, normalized]
  saveRows(WATER_KEY, nextRows)
  return { ok: true, message: id !== undefined ? '水质监测记录已补齐保存' : '水质监测记录已登记', row: normalized }
}

export type WaterExportBlock = { id: number; gaps: RowGap[] }

export type WaterExportOutcome = {
  ok: boolean
  /** empty=没有可导记录；denied=越权；done=已出文件；blocked=全部被拦下 */
  kind: 'empty' | 'denied' | 'done' | 'blocked'
  message: string
  filename?: string
  content?: string
  exportedIds: number[]
  blocked: WaterExportBlock[]
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * 整包导出水质监测清单：
 * - 只有本岗位的检验人推得动导出，越权直接拒绝；
 * - 缺项记录逐条拦下并说明，不再让整包报错、也不再堆半截文件；
 * - 每条记录导出后立刻落台账，中途断掉不丢已导出的，重试只补没成功的那几笔；
 * - 同一条取样记录重复导出只算一次。
 */
export function exportWaterBatch(post: string): WaterExportOutcome {
  const meta = moduleMeta(WATER_KEY)
  const denied: WaterExportOutcome = {
    ok: false,
    kind: 'denied',
    message: `当前岗位「${post || '未设置'}」无权导出${meta.name}清单，需由「${meta.exportPost}」岗位操作`,
    exportedIds: [],
    blocked: [],
  }
  if (meta.exportPost && post !== meta.exportPost) {
    return denied
  }
  const rows = listRows(WATER_KEY)
  if (rows.length === 0) {
    return {
      ok: false,
      kind: 'empty',
      message: '暂无水质监测记录，先登记再导出',
      exportedIds: [],
      blocked: [],
    }
  }
  const pendingRows = rows.filter((row) => !isRowExported(row))
  const blocked: WaterExportBlock[] = pendingRows
    .map((row) => ({ id: Number(row.id), gaps: findRowGaps(row) }))
    .filter((item) => item.gaps.length > 0)
  const exportable = pendingRows.filter((row) => findRowGaps(row).length === 0)
  if (exportable.length === 0) {
    if (blocked.length > 0) {
      return {
        ok: false,
        kind: 'blocked',
        message: `没有可导出的记录：${blocked.length} 条记录缺项待补齐，补齐后重新导出即可`,
        exportedIds: [],
        blocked,
      }
    }
    return {
      ok: false,
      kind: 'empty',
      message: '没有可导出的记录：登记过的记录都已导出，同一条取样记录不会重复导出',
      exportedIds: [],
      blocked: [],
    }
  }
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const usedBatches = new Set(rows.map((row) => String(row['导出批次'] ?? '')).filter(Boolean))
  const batchNo = `WEXP-${today}-${String(usedBatches.size + 1).padStart(3, '0')}`
  const exportedAt = new Date().toISOString()
  const header = ['编号', ...meta.fields, '当前状态', '导出批次']
  const lines = [header.map(csvCell).join(',')]
  // 逐条落台账：每条先标记持久化再进文件，中途断掉已导出的那些也丢不了。
  const exportedIds: number[] = []
  let current = listRows(WATER_KEY)
  for (const row of exportable) {
    lines.push(
      [row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status, batchNo]
        .map(csvCell)
        .join(','),
    )
    current = current.map((item) =>
      Number(item.id) === Number(row.id)
        ? { ...item, 导出批次: batchNo, 导出时间: exportedAt }
        : item,
    )
    saveRows(WATER_KEY, current)
    exportedIds.push(Number(row.id))
  }
  const blockedNote = blocked.length > 0 ? `，另有 ${blocked.length} 条缺项被拦下，补齐后重新导出即可补上` : ''
  return {
    ok: true,
    kind: 'done',
    message: `已导出 ${exportedIds.length} 条水质监测记录（批次 ${batchNo}）${blockedNote}`,
    filename: `${meta.name}清单-${batchNo}.csv`,
    content: `\uFEFF${lines.join('\n')}`,
    exportedIds,
    blocked,
  }
}

export function downloadFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  downloadFile(filename, content)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
