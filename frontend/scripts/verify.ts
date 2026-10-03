// 核心流程验证脚本：用 esbuild 打包后在 node 里跑，localStorage 用内存模拟。
import assert from 'node:assert'

// ---- localStorage / DOM 内存模拟（要在 import 数据层之前挂好）----
const store = new Map<string, string>()
const localStorageMock = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
}
;(globalThis as any).window = { localStorage: localStorageMock }
;(globalThis as any).document = {
  createElement: () => ({ click() {}, remove() {} }),
  body: { appendChild() {}, removeChild() {} },
}
;(globalThis as any).URL.createObjectURL = () => 'blob:mock'
;(globalThis as any).URL.revokeObjectURL = () => {}
;(globalThis as any).Blob = class {}

const {
  listEntries,
  runAction,
  updateEntry,
  getEntry,
  exportModuleEntries,
  exportStatusMap,
  resetModule,
} = await import('@/api/local-service')
const { listRows, saveRows } = await import('@/data/local-store')

const INSPECTOR = { name: '当班检验员', role: '水质检验人' }
const ADMIN = { name: '值班管理员', role: '值班管理员' }

let passed = 0
function ok(name: string, cond: boolean, extra?: unknown) {
  assert(cond, `✗ ${name} ${extra !== undefined ? JSON.stringify(extra) : ''}`)
  passed += 1
  console.log(`✓ ${name}`)
}

// ---- 1. 迁移：v1 存量数据（无版本号、无结论字段）按旧记录回填 ----
const legacy = {
  watermonitor: [
    { id: 1, status: '已合格', pending: false, abnormal: false, 取样点: 'PW-101', 水系统类别: '纯化水', 电导率: '1.3', 总有机碳: '320', 微生物限度: '10', 取样日期: '2026-09-01', 检验人: '张三', 水质状态: '正常' },
    { id: 2, status: '检测中', pending: true, abnormal: false, 取样点: 'PW-102', 水系统类别: '纯化水', 电导率: '1.1', 总有机碳: '280', 微生物限度: '8', 取样日期: '2026-09-02', 检验人: '李四', 水质状态: '正常' },
    { id: 3, status: '不合格', pending: false, abnormal: true, 取样点: 'WFI-201', 水系统类别: '注射用水', 电导率: '1.0', 总有机碳: '500', 微生物限度: '12', 取样日期: '2026-09-03', 检验人: '王五', 水质状态: '超标' },
  ],
}
localStorageMock.setItem('pharma-cleanroom:entries', JSON.stringify(legacy))
const rows = listRows('watermonitor') // 首次读取即触发迁移
ok('迁移回填结论：已合格→合格', rows[0]['结论'] === '合格', rows[0])
ok('迁移回填结论：检测中→未判定', rows[1]['结论'] === '未判定')
ok('迁移回填结论：不合格→不合格', rows[2]['结论'] === '不合格')
ok('迁移写入版本号', localStorageMock.getItem('pharma-cleanroom:entries:version') === '2')

// ---- 2. 越权导出被拒绝 ----
let report = await exportModuleEntries('watermonitor', ADMIN)
ok('越权导出拒绝', !report.ok && report.kind === 'denied', report.message)

// ---- 3. 本岗位检验人导出成功；连点两回只跑一批；重复导出只算一次 ----
const first = exportModuleEntries('watermonitor', INSPECTOR)
const second = await exportModuleEntries('watermonitor', INSPECTOR)
ok('连点两回只跑一批', !second.ok && second.kind === 'busy', second.message)
report = await first
ok('检验人导出成功', report.ok && report.kind === 'done' && report.newlyExported === 3, report)
report = await exportModuleEntries('watermonitor', INSPECTOR)
ok('重复导出只算一次（noop）', report.ok && report.kind === 'noop' && report.newlyExported === 0 && report.skipped === 3, report)

// ---- 4. 缺项与无效值：单笔失败不拖垮整包，重试只补失败笔 ----
resetModule('watermonitor')
ok('重置后台账清空', Object.keys(exportStatusMap('watermonitor')).length === 0)
ok('重置后记录已回填结论字段', listRows('watermonitor').every((r) => r['结论'] !== undefined))

let res = updateEntry('watermonitor', 1, { 总有机碳: 'abc' })
ok('TOC 无效值被拦下', !res.ok && res.message.includes('总有机碳'), res.message)
res = updateEntry('watermonitor', 1, { 取样点: '' })
ok('必填缺项被拦下', !res.ok && res.message.includes('取样点'), res.message)

// 写入受控脏数据：#1 取样点空、#2 TOC 无效、#3 正常
const controlled = listRows('watermonitor').map((r, i) => ({
  ...r,
  取样点: `PT-${i + 1}`,
  电导率: '1.2',
  总有机碳: 300 + i,
}))
controlled[0]['取样点'] = ''
controlled[1]['总有机碳'] = 'abc'
saveRows('watermonitor', controlled)

report = await exportModuleEntries('watermonitor', INSPECTOR)
ok('部分完成：2 笔失败 1 笔导出', report.ok && report.kind === 'partial' && report.newlyExported === 1 && report.failures.length === 2, report)
ok('失败原因含字段名', report.failures.some((f) => f.reason.includes('取样点')) && report.failures.some((f) => f.reason.includes('总有机碳')), report.failures)
const statusMap = exportStatusMap('watermonitor')
ok('台账逐笔状态：失败带原因', statusMap['1'].status === '失败' && statusMap['2'].status === '失败' && statusMap['3'].status === '成功', statusMap)

res = updateEntry('watermonitor', 1, { 取样点: 'PT-1' })
ok('补录取样点保存成功', res.ok, res.message)
res = updateEntry('watermonitor', 2, { 总有机碳: '300' })
ok('修正 TOC 保存成功', res.ok, res.message)
ok('TOC 落库为数字', getEntry('watermonitor', 2)!['总有机碳'] === 300)
report = await exportModuleEntries('watermonitor', INSPECTOR)
ok('重试只补失败笔', report.ok && report.kind === 'done' && report.newlyExported === 2 && report.retried === 2 && report.skipped === 1, report)

// ---- 5. 结论同步到变更控制台账（幂等 upsert）----
const synced = listRows('changecontrol').filter((r) => String(r['变更编号']).startsWith('WATER-'))
ok('结论同步到变更控制台账', synced.length === 3, synced.map((r) => r['变更编号']))
ok('同步内容含取样点与结论', synced.every((r) => String(r['变更内容']).includes('水质结论')))
await exportModuleEntries('watermonitor', INSPECTOR)
const syncedAgain = listRows('changecontrol').filter((r) => String(r['变更编号']).startsWith('WATER-'))
ok('重复同步不产生重复台账', syncedAgain.length === 3)

// ---- 6. 状态一节一节推进，越级挡回 ----
resetModule('watermonitor')
res = runAction('watermonitor', 1, '判定合格')
ok('待取样直接判定合格被挡回', !res.ok && res.message.includes('挡回'), res.message)
res = runAction('watermonitor', 1, '提交检测')
ok('待取样→检测中 放行', res.ok, res.message)
res = runAction('watermonitor', 1, '提交检测')
ok('越级/重复动作被挡回', !res.ok, res.message)
res = runAction('watermonitor', 1, '判定合格')
ok('检测中→已合格 放行', res.ok, res.message)
ok('判定后结论写入记录', getEntry('watermonitor', 1)!['结论'] === '合格')
res = runAction('watermonitor', 2, '标记不合格')
ok('检测中→不合格 放行且结论写入', res.ok && getEntry('watermonitor', 2)!['结论'] === '不合格', res.message)

// ---- 7. 空态：没有可导记录 ----
saveRows('watermonitor', [])
report = await exportModuleEntries('watermonitor', INSPECTOR)
ok('空列表导出给空态说明', !report.ok && report.kind === 'empty', report.message)

// ---- 8. 列表与详情同源 ----
resetModule('watermonitor')
const listPayload = listEntries('watermonitor')
const detail = getEntry('watermonitor', Number(listPayload.items[0].id))
ok('列表与详情读到同一套值', JSON.stringify(listPayload.items[0]) === JSON.stringify(detail))

console.log(`\n全部 ${passed} 项验证通过`)
