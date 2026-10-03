<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">制药企业洁净区与批生产记录管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向洁净区环境监测、批生产记录编录、物料放行、偏差与变更控制、灭菌与清洁验证、成品检验与年度质量回顾的一体化药品生产质量管理工作台。</span>
        <span class="head-user">当前值班：{{ store.operator }}（{{ store.role }}） · {{ store.shiftLabel }}</span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const navItems = [{ label: "运营概览", path: "/" }, { label: "批生产记录", path: "/batchrecord" }, { label: "洁净区环境监测", path: "/cleanroom" }, { label: "物料放行", path: "/materialrelease" }, { label: "偏差处理", path: "/deviation" }, { label: "变更控制", path: "/changecontrol" }, { label: "清洁验证", path: "/cleanvalidate" }, { label: "灭菌验证", path: "/sterilize" }, { label: "培养基模拟灌装", path: "/mediafill" }, { label: "工艺用水监测", path: "/watermonitor" }, { label: "更衣确认", path: "/gowning" }, { label: "成品检验", path: "/finishedqc" }, { label: "留样管理", path: "/retainsample" }, { label: "稳定性考察", path: "/stability" }, { label: "产品召回", path: "/recall" }, { label: "供应商审计", path: "/supplieraudit" }, { label: "人员培训", path: "/training" }, { label: "年度质量回顾", path: "/annualreview" }, { label: "质量投诉", path: "/complaint" }]
</script>
