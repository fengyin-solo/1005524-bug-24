/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 保存与导出前必须写全的字段，缺项会被拦下 */
  requiredFields?: string[]
  /** 必须是不小于 0 的有效数字的字段，填成无效值会被拦下补齐 */
  numericFields?: string[]
  /** 动作允许的发起状态：状态只能一节一节推进，不在名单里的发起状态会被挡回 */
  transitions?: Record<string, string[]>
  /** 允许触发导出的岗位，其他岗位导出会被拒绝 */
  exportRole?: string
  /** 结论字段名：动作命中时把对应结论写进记录 */
  conclusionField?: string
  /** 动作 → 结论值，配合 conclusionField 使用 */
  actionConclusions?: Record<string, string>
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 单笔导出失败：编号 + 原因，页面照着提示补齐 */
export type ExportFailure = {
  id: number
  reason: string
}

export type ExportReport = {
  ok: boolean
  /** denied 越权 / busy 上一批未结束 / empty 无可导记录 / failed 整包未通过 / partial 部分成功 / done 本次有新导出 / noop 全部已导过 */
  kind: 'denied' | 'busy' | 'empty' | 'failed' | 'partial' | 'done' | 'noop'
  message: string
  filename?: string
  /** 本次新导出的笔数（含补录） */
  newlyExported: number
  /** 本次补上的之前失败的笔数 */
  retried: number
  /** 之前已导出、本次略过的笔数（同一条记录只算一次） */
  skipped: number
  failures: ExportFailure[]
}

export type ExportProgress = {
  done: number
  total: number
}
