import { MODULE_BY_KEY } from '@/data/modules'
import {
  beginBatch,
  clearLedger,
  finishBatch,
  ledgerRecords,
  recordResult,
} from '@/data/export-ledger'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ExportFailure,
  ExportProgress,
  ExportReport,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 结论同步的目标台账：水质监测的判定结论导出后落到变更控制模块。
const CHANGE_CONTROL_KEY = 'changecontrol'

// 进行中的导出：同一模块同一时刻只跑一批，连点也不会堆出第二份文件。
const runningExports = new Set<string>()

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

export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === id)
}

/** 校验一条记录的字段值：必填缺项、数值字段无效值，逐条列出问题。 */
export function validateRowValues(meta: ModuleMeta, row: EntryRow): string[] {
  const problems: string[] = []
  for (const field of meta.requiredFields ?? []) {
    if (String(row[field] ?? '').trim() === '') {
      problems.push(`${field}未填写`)
    }
  }
  for (const field of meta.numericFields ?? []) {
    const raw = String(row[field] ?? '').trim()
    if (raw === '') {
      continue // 空值归必填管，这里不重复报
    }
    const num = Number(raw)
    if (!Number.isFinite(num) || num < 0) {
      problems.push(`${field}不是有效数值`)
    }
  }
  return problems
}

/** 保存单笔记录的字段修改：先校验，无效值拦下，由页面提示补齐。 */
export function updateEntry(
  key: string,
  id: number,
  patch: Record<string, string>,
): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const merged: EntryRow = { ...rows[index] }
  for (const field of meta.fields) {
    if (field in patch) {
      merged[field] = String(patch[field]).trim()
    }
  }
  const problems = validateRowValues(meta, merged)
  if (problems.length > 0) {
    return { ok: false, message: `保存被拦下：${problems.join('；')}，请补齐修正后再保存` }
  }
  // 数值字段统一落成数字，列表、详情、导出多处读到的才是同一套值
  for (const field of meta.numericFields ?? []) {
    merged[field] = Number(merged[field])
  }
  const next = [...rows]
  next[index] = merged
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已保存` }
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
  // 状态一节一节推进：动作只允许从登记的发起状态走，越级直接挡回
  const sources = meta.transitions?.[action]
  if (sources && !sources.includes(current)) {
    return {
      ok: false,
      message: `状态需一节一节推进：「${action}」只能从「${sources.join('」「')}」发起，当前状态「${current}」，已挡回`,
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (meta.conclusionField && meta.actionConclusions?.[action]) {
    updated[meta.conclusionField] = meta.actionConclusions[action]
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  clearLedger(key)
  return listEntries(key)
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function buildCsv(meta: ModuleMeta, rows: EntryRow[]): string {
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].map(csvCell).join(','))
  }
  return `\uFEFF${lines.join('\n')}`
}

function downloadCsv(filename: string, content: string): void {  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
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
  return { filename: `${meta.name}-清单.csv`, content: buildCsv(meta, listRows(key)) }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  downloadCsv(filename, content)
}

/** 某模块每笔记录的导出状态，给页面展示「未导出 / 已导出 / 失败原因」。 */
export function exportStatusMap(key: string): Record<string, { status: string; reason?: string }> {
  return ledgerRecords(key)
}

/** 结论同步到变更控制台账：按来源编号 upsert，重复同步不会产生重复条目。 */
function syncConclusions(meta: ModuleMeta, rows: EntryRow[], operatorName: string): void {
  if (!meta.conclusionField || !MODULE_BY_KEY.has(CHANGE_CONTROL_KEY)) {
    return
  }
  const conclusionField = meta.conclusionField
  const existing = listRows(CHANGE_CONTROL_KEY)
  const next = [...existing]
  let maxId = existing.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  for (const row of rows) {
    const code = `WATER-${String(Number(row.id)).padStart(4, '0')}`
    const conclusion = String(row[conclusionField] ?? '未判定')
    const payload: EntryRow = {
      id: 0,
      status: '待评估',
      pending: true,
      abnormal: row.abnormal === true || conclusion === '不合格',
      变更编号: code,
      变更类别: '水质监测结论同步',
      涉及工序: String(row['水系统类别'] ?? ''),
      变更内容: `取样点「${String(row['取样点'] ?? '')}」水质结论：${conclusion}`,
      风险评估: '例行监测结论',
      审批人: String(row['检验人'] ?? operatorName),
      生效日期: String(row['取样日期'] ?? ''),
      变更状态: conclusion,
    }
    const index = next.findIndex((item) => item['变更编号'] === code)
    if (index >= 0) {
      payload.id = next[index].id
      payload.status = next[index].status // 台账里已流转的状态保留，不被同步冲掉
      next[index] = payload
    } else {
      maxId += 1
      payload.id = maxId
      next.push(payload)
    }
  }
  saveRows(CHANGE_CONTROL_KEY, next)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 整包导出：逐笔校验、逐笔落账，异步让出主线程不卡界面。
 * 缺项或无效值只标那一笔，其余照常；文件只由完整成功的记录生成，不出半截文件。
 */
export async function exportModuleEntries(
  key: string,
  operator: { name: string; role: string },
  onProgress?: (progress: ExportProgress) => void,
): Promise<ExportReport> {
  const meta = moduleMeta(key)
  const base = { newlyExported: 0, retried: 0, skipped: 0, failures: [] as ExportFailure[] }
  if (runningExports.has(key)) {
    return {
      ...base,
      ok: false,
      kind: 'busy',
      message: '上一批导出还没结束，这次点击已忽略，不会重复生成文件',
    }
  }
  if (meta.exportRole && operator.role !== meta.exportRole) {
    return {
      ...base,
      ok: false,
      kind: 'denied',
      message: `越权导出已拒绝：只有${meta.exportRole}才能导出${meta.name}，当前岗位「${operator.role}」`,
    }
  }
  const rows = listRows(key)
  if (rows.length === 0) {
    return {
      ...base,
      ok: false,
      kind: 'empty',
      message: `暂无可导出的${meta.entity}：列表为空，请先登记记录`,
    }
  }
  runningExports.add(key)
  try {
    const before = ledgerRecords(key)
    const alreadyDone = new Set(
      Object.entries(before)
        .filter(([, item]) => item.status === '成功')
        .map(([id]) => Number(id)),
    )
    // 同一条取样记录重复导出只算一次：已成功的略过，只处理没成功的
    const todo = rows.filter((row) => !alreadyDone.has(Number(row.id)))
    const skipped = rows.length - todo.length
    const batchId = `EXP-${Date.now()}`
    beginBatch(key, batchId)
    const failures: ExportFailure[] = []
    const successIds: number[] = []
    let retried = 0
    for (const row of todo) {
      const id = Number(row.id)
      const wasFailed = before[String(id)]?.status === '失败'
      const problems = validateRowValues(meta, row)
      if (problems.length === 0) {
        recordResult(key, id, { status: '成功', batchId, exportedAt: new Date().toISOString() })
        successIds.push(id)
        if (wasFailed) {
          retried += 1
        }
      } else {
        const reason = problems.join('；')
        recordResult(key, id, { status: '失败', reason, batchId })
        failures.push({ id, reason })
      }
      onProgress?.({ done: successIds.length + failures.length, total: todo.length })
      await sleep(60) // 让出主线程：界面不卡，进度可见
    }
    finishBatch(key, batchId, successIds, failures)

    // 台账里所有成功的记录（同一条只算一次）合成完整清单
    const latest = ledgerRecords(key)
    const exportedRows = rows.filter((row) => latest[String(Number(row.id))]?.status === '成功')
    let filename: string | undefined
    if (exportedRows.length > 0) {
      filename = `${meta.name}-清单.csv`
      downloadCsv(filename, buildCsv(meta, exportedRows))
      syncConclusions(meta, exportedRows, operator.name)
    }
    const newlyExported = successIds.length
    if (failures.length > 0) {
      const detail = failures.map((item) => `#${item.id} ${item.reason}`).join('；')
      if (exportedRows.length === 0) {
        return {
          ...base,
          ok: false,
          kind: 'failed',
          message: `整包导出未完成：${failures.length} 笔均未通过校验（${detail}），未生成文件，请补齐后重试`,
          failures,
        }
      }
      return {
        ...base,
        ok: true,
        kind: 'partial',
        message: `部分完成：${newlyExported} 笔新导出（含补录 ${retried} 笔），${failures.length} 笔未通过校验（${detail}），修正后重试只补这几笔`,
        filename,
        newlyExported,
        retried,
        skipped,
        failures,
      }
    }
    if (newlyExported === 0) {
      return {
        ...base,
        ok: true,
        kind: 'noop',
        message: `没有新的可导记录：${skipped} 笔全部已导出过，同一条只算一次，已重新生成完整清单`,
        filename,
        skipped,
        failures,
      }
    }
    return {
      ...base,
      ok: true,
      kind: 'done',
      message: `导出完成：本次新导出 ${newlyExported} 笔${retried > 0 ? `（含补录 ${retried} 笔）` : ''}，清单共 ${exportedRows.length} 笔`,
      filename,
      newlyExported,
      retried,
      skipped,
      failures,
    }
  } finally {
    runningExports.delete(key)
  }
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
