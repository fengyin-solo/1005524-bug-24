<template>
  <section class="page" data-module="watermonitor">
    <header class="page-head">
      <div>
        <h2>工艺用水监测管理</h2>
        <p class="page-desc">维护水质监测记录，围绕取样点、水系统类别、电导率、总有机碳做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记水质监测记录</button>
        <button class="btn" type="button" :disabled="exporting" @click="exportRows">
          {{ exporting ? '导出中…' : '导出工艺用水监测清单' }}
        </button>
      </div>
    </header>

    <p class="info-text">导出需「{{ exportPost }}」岗位，当前岗位：{{ session.post }}；取样点、电导率、总有机碳写全的记录才会进入导出包。</p>

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

    <div v-if="exportNotice.message" class="export-notice">
      <p :class="exportNotice.kind === 'ok' ? 'ok-text' : exportNotice.kind === 'error' ? 'error-text' : 'info-text'">
        {{ exportNotice.message }}
      </p>
      <ul v-if="exportNotice.blocked.length" class="blocked-list">
        <li v-for="item in exportNotice.blocked" :key="item.id">
          记录 #{{ item.id }}：{{ item.gaps.map((gap) => gap.reason).join('；') }}
          <button class="link" type="button" @click="openFix(item.id)">去补齐</button>
        </li>
      </ul>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>完整性</th>
          <th>导出状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span v-if="isComplete(row)" class="badge ok">完整</span>
            <span v-else class="badge warn">待补齐</span>
          </td>
          <td>
            <span v-if="isExported(row)" class="badge ok">已导出 · {{ row['导出批次'] }}</span>
            <span v-else class="badge">待导出</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openDetail(row)">查看</button>
            <button v-if="!isComplete(row)" class="link" type="button" @click="openFix(Number(row.id))">补齐</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无工艺用水监测数据，可先登记水质监测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条工艺用水监测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detailRow" class="modal-mask" @click.self="detailRow = null">
      <div class="modal-card">
        <h3>水质监测记录详情 #{{ detailRow.id }}</h3>
        <dl class="detail-grid">
          <div v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ detailRow[column] ?? '—' }}</dd>
          </div>
          <div>
            <dt>当前状态</dt>
            <dd>{{ detailRow.status }}</dd>
          </div>
          <div>
            <dt>导出批次</dt>
            <dd>{{ detailRow['导出批次'] || '待导出' }}</dd>
          </div>
          <div>
            <dt>导出时间</dt>
            <dd>{{ detailRow['导出时间'] || '—' }}</dd>
          </div>
          <div>
            <dt>结论同步</dt>
            <dd>{{ detailRow['结论同步'] || '未同步' }}</dd>
          </div>
        </dl>
        <div class="form-actions">
          <button class="btn" type="button" @click="detailRow = null">关闭</button>
        </div>
      </div>
    </div>

    <div v-if="showForm" class="modal-mask" @click.self="closeForm">
      <div class="modal-card">
        <h3>{{ editingId === null ? '登记水质监测记录' : `补齐水质监测记录 #${editingId}` }}</h3>
        <div class="form-grid">
          <label v-for="field in columns" :key="field" class="form-item">
            <span>{{ field }}{{ requiredFields.includes(field) ? '（必填）' : '' }}</span>
            <input v-model="form[field]" :placeholder="field === '总有机碳' ? '如 0.320 mg/L 或 320 µg/L' : `填写${field}`" />
          </label>
        </div>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="form-actions">
          <button class="btn ghost" type="button" @click="closeForm">取消</button>
          <button class="btn primary" type="button" @click="submitForm">保存</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadFile,
  exportWaterBatch,
  getEntry,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  saveWaterEntry,
  type WaterExportBlock,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { findRowGaps, isRowExported, WATER_EXPORT_POST } from '@/data/waterquality'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('watermonitor')
const session = useSessionStore()
const exportPost = WATER_EXPORT_POST
const columns = ["取样点", "水系统类别", "电导率", "总有机碳", "微生物限度", "取样日期", "检验人", "水质状态"]
const actions = ["提交检测", "判定合格", "标记不合格"]
const statuses = ["待取样", "检测中", "已合格", "不合格"]
const requiredFields: string[] = ["取样点", "电导率", "总有机碳"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const exporting = ref(false)
const exportNotice = ref<{ kind: 'ok' | 'info' | 'error'; message: string; blocked: WaterExportBlock[] }>({
  kind: 'info',
  message: '',
  blocked: [],
})

const detailRow = ref<EntryRow | null>(null)
const showForm = ref(false)
const editingId = ref<number | null>(null)
const form = ref<Record<string, string>>({})
const formError = ref('')

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待取样点位', value: rows.value.filter((row) => row.status === '待取样').length },
  { label: '检测中样品', value: rows.value.filter((row) => row.status === '检测中').length },
  { label: '不合格点位数', value: rows.value.filter((row) => row.status === '不合格').length },
  { label: '待补齐记录', value: rows.value.filter((row) => findRowGaps(row).length > 0).length },
  { label: '已导出记录', value: rows.value.filter((row) => isRowExported(row)).length },
])

function isComplete(row: EntryRow): boolean {
  return findRowGaps(row).length === 0
}

function isExported(row: EntryRow): boolean {
  return isRowExported(row)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  // 导出进行中直接挡回，连点不会堆出第二份文件。
  if (exporting.value) {
    return
  }
  exporting.value = true
  exportNotice.value = { kind: 'info', message: '', blocked: [] }
  try {
    const outcome = exportWaterBatch(session.post)
    if (outcome.ok && outcome.filename && outcome.content) {
      downloadFile(outcome.filename, outcome.content)
    }
    exportNotice.value = {
      kind: outcome.ok ? 'ok' : outcome.kind === 'empty' ? 'info' : 'error',
      message: outcome.message,
      blocked: outcome.blocked,
    }
    reload()
  } finally {
    exporting.value = false
  }
}

function openCreate() {
  editingId.value = null
  form.value = {
    取样点: '',
    水系统类别: '纯化水',
    电导率: '',
    总有机碳: '',
    微生物限度: '',
    取样日期: new Date().toISOString().slice(0, 10),
    检验人: session.operator,
    水质状态: '待判定',
  }
  formError.value = ''
  showForm.value = true
}

function openFix(id: number) {
  const row = getEntry(meta.key, id)
  if (!row) {
    errorMessage.value = `没有找到编号为 ${id} 的水质监测记录`
    return
  }
  editingId.value = id
  form.value = Object.fromEntries(columns.map((column) => [column, String(row[column] ?? '')]))
  formError.value = ''
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  formError.value = ''
}

function submitForm() {
  const result = saveWaterEntry(form.value, editingId.value ?? undefined)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  closeForm()
  reload()
}

function openDetail(row: EntryRow) {
  // 详情按编号重新读同一份数据，和列表看到的保持一致。
  detailRow.value = getEntry(meta.key, Number(row.id))
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '工艺用水监测列表读取失败'
  }
}

onMounted(reload)
</script>
