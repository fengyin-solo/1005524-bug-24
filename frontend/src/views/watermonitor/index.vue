<template>
  <section class="page" data-module="watermonitor">
    <header class="page-head">
      <div>
        <h2>工艺用水监测管理</h2>
        <p class="page-desc">维护水质监测记录，围绕取样点、水系统类别、电导率、总有机碳做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <label class="role-switch">
          <span>当前岗位</span>
          <select :value="session.role" @change="onRoleChange">
            <option v-for="role in roles" :key="role" :value="role">{{ role }}</option>
          </select>
        </label>
        <button class="btn primary" type="button" @click="openCreate">登记水质监测记录</button>
        <button class="btn" type="button" :disabled="exporting" @click="exportRows">
          {{ exportLabel }}
        </button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>结论</th>
          <th>当前状态</th>
          <th>导出状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row['结论'] ?? '未判定' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span class="export-badge" :class="exportBadgeClass(row.id)">
              {{ exportStatusText(row.id) }}
            </span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无工艺用水监测数据，可先登记水质监测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条工艺用水监测记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <aside v-if="detailRow" class="detail-panel">
      <header class="detail-head">
        <h3>取样记录详情 #{{ detailRow.id }}</h3>
        <button class="link" type="button" @click="closeDetail">关闭</button>
      </header>
      <dl class="detail-meta">
        <div>
          <dt>当前状态</dt>
          <dd>{{ detailRow.status }}</dd>
        </div>
        <div>
          <dt>结论</dt>
          <dd>{{ detailRow['结论'] ?? '未判定' }}</dd>
        </div>
        <div>
          <dt>导出状态</dt>
          <dd>{{ exportStatusText(detailRow.id) }}</dd>
        </div>
      </dl>
      <form class="detail-form" @submit.prevent="saveDetail">
        <label v-for="field in columns" :key="field" class="filter-item">
          <span>
            {{ field }}
            <em v-if="isRequired(field)" class="required-mark">*</em>
          </span>
          <input v-model="draft[field]" :placeholder="`请输入${field}`" />
        </label>
        <p class="form-hint">
          取样点、电导率、总有机碳必填；总有机碳需为不小于 0 的数字，填成无效值会被拦下补齐。
        </p>
        <p v-if="detailError" class="error-text">{{ detailError }}</p>
        <p v-if="detailNotice" class="notice-text">{{ detailNotice }}</p>
        <div class="detail-actions">
          <button class="btn primary" type="submit">保存修改</button>
          <button class="btn ghost" type="button" @click="closeDetail">取消</button>
        </div>
      </form>
    </aside>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  exportModuleEntries,
  exportStatusMap,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  updateEntry,
} from '@/api/local-service'
import type { EntryRow, ExportProgress } from '@/data/types'
import { OPERATOR_ROLES, useSessionStore } from '@/stores/session'

const meta = moduleMeta('watermonitor')
const columns = ["取样点", "水系统类别", "电导率", "总有机碳", "微生物限度", "取样日期", "检验人", "水质状态"]
const actions = ["提交检测", "判定合格", "标记不合格"]
const statuses = ["待取样", "检测中", "已合格", "不合格"]
const stats = [{"label": "待取样点位", "value": 0}, {"label": "检测中样品", "value": 0}, {"label": "不合格点位数", "value": 0}]
const requiredFields = meta.requiredFields ?? []

const session = useSessionStore()
const roles = OPERATOR_ROLES

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 导出台账：逐笔状态（未导出 / 已导出 / 失败原因），导出后刷新
const ledgerMap = ref<Record<string, { status: string; reason?: string }>>({})
const exporting = ref(false)
const progress = ref<ExportProgress | null>(null)

// 详情面板：直接取列表同一份数据，两处读到的值保持一致
const detailId = ref<number | null>(null)
const detailRow = computed(
  () => rows.value.find((row) => Number(row.id) === detailId.value) ?? null,
)
const draft = ref<Record<string, string>>({})
const detailError = ref('')
const detailNotice = ref('')

const failedCount = computed(
  () => Object.values(ledgerMap.value).filter((item) => item.status === '失败').length,
)

const exportLabel = computed(() => {
  if (exporting.value) {
    return progress.value ? `导出中 ${progress.value.done}/${progress.value.total}` : '导出中…'
  }
  return failedCount.value > 0 ? `重试导出（补 ${failedCount.value} 笔失败）` : '导出工艺用水监测清单'
})

function isRequired(field: string): boolean {
  return requiredFields.includes(field)
}

function exportStatusText(id: number | string): string {
  const item = ledgerMap.value[String(id)]
  if (!item) {
    return '未导出'
  }
  return item.status === '失败' ? `导出失败：${item.reason ?? '未知原因'}` : '已导出'
}

function exportBadgeClass(id: number | string): string {
  const item = ledgerMap.value[String(id)]
  if (!item) {
    return 'muted'
  }
  return item.status === '失败' ? 'bad' : 'good'
}

function refreshLedger() {
  ledgerMap.value = exportStatusMap(meta.key)
}

function onRoleChange(event: Event) {
  session.setRole((event.target as HTMLSelectElement).value)
  noticeMessage.value = ''
  errorMessage.value = ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

async function exportRows() {
  errorMessage.value = ''
  noticeMessage.value = ''
  exporting.value = true
  progress.value = null
  try {
    const report = await exportModuleEntries(
      meta.key,
      { name: session.operator, role: session.role },
      (value) => {
        progress.value = value
      },
    )
    refreshLedger()
    reload()
    if (report.ok) {
      noticeMessage.value = report.message
    } else {
      errorMessage.value = report.message
    }
  } finally {
    exporting.value = false
    progress.value = null
  }
}

function openCreate() {
  errorMessage.value = '水质监测记录登记入口尚未接入审批流'
}

function openDetail(row: EntryRow) {
  detailId.value = Number(row.id)
  const next: Record<string, string> = {}
  for (const field of columns) {
    next[field] = String(row[field] ?? '')
  }
  draft.value = next
  detailError.value = ''
  detailNotice.value = ''
}

function closeDetail() {
  detailId.value = null
  detailError.value = ''
  detailNotice.value = ''
}

function saveDetail() {
  if (detailId.value === null) {
    return
  }
  const result = updateEntry(meta.key, detailId.value, draft.value)
  if (!result.ok) {
    detailError.value = result.message
    detailNotice.value = ''
    return
  }
  detailError.value = ''
  detailNotice.value = result.message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '工艺用水监测列表读取失败'
  }
}

onMounted(() => {
  refreshLedger()
  reload()
})
</script>
