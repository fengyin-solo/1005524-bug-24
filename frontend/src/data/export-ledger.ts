// 导出台账：每笔记录的导出状态单独持久化在 localStorage。
// 中途断掉（关页面、刷新）已导出的不丢；重试只补没成功的；同一条记录重复导出只算一次。

export type LedgerRecord = {
  status: '成功' | '失败'
  reason?: string
  batchId?: string
  exportedAt?: string
}

export type ExportBatch = {
  id: string
  startedAt: string
  finishedAt?: string
  successIds: number[]
  failures: { id: number; reason: string }[]
}

type ModuleLedger = {
  records: Record<string, LedgerRecord>
  batches: ExportBatch[]
}

const STORAGE_KEY = 'pharma-cleanroom:export-ledger'
const BATCH_KEEP = 20

function emptyLedger(): ModuleLedger {
  return { records: {}, batches: [] }
}

function readAll(): Record<string, ModuleLedger> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return {}
  }
  try {
    return JSON.parse(raw) as Record<string, ModuleLedger>
  } catch {
    return {}
  }
}

function writeAll(all: Record<string, ModuleLedger>): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
}

function withLedger(key: string, mutate: (ledger: ModuleLedger) => void): ModuleLedger {
  const all = readAll()
  const ledger = all[key] ?? emptyLedger()
  mutate(ledger)
  all[key] = ledger
  writeAll(all)
  return ledger
}

/** 某模块每笔记录的导出状态，键是记录编号。 */
export function ledgerRecords(key: string): Record<string, LedgerRecord> {
  return { ...(readAll()[key]?.records ?? {}) }
}

/** 单笔结果落账：每处理一笔就写一次，断掉也不丢已导出的。 */
export function recordResult(key: string, rowId: number, result: LedgerRecord): void {
  withLedger(key, (ledger) => {
    ledger.records[String(rowId)] = result
  })
}

export function beginBatch(key: string, batchId: string): void {
  withLedger(key, (ledger) => {
    ledger.batches.push({
      id: batchId,
      startedAt: new Date().toISOString(),
      successIds: [],
      failures: [],
    })
    if (ledger.batches.length > BATCH_KEEP) {
      ledger.batches = ledger.batches.slice(-BATCH_KEEP)
    }
  })
}

export function finishBatch(
  key: string,
  batchId: string,
  successIds: number[],
  failures: { id: number; reason: string }[],
): void {
  withLedger(key, (ledger) => {
    const batch = ledger.batches.find((item) => item.id === batchId)
    if (!batch) {
      return
    }
    batch.finishedAt = new Date().toISOString()
    batch.successIds = successIds
    batch.failures = failures
  })
}

export function listBatches(key: string): ExportBatch[] {
  return [...(readAll()[key]?.batches ?? [])]
}

export function clearLedger(key: string): void {
  const all = readAll()
  delete all[key]
  writeAll(all)
}
