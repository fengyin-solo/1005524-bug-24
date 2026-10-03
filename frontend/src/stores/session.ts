import { defineStore } from 'pinia'

// 岗位清单：导出等敏感动作按岗位放行，越权会被拒绝。
export const OPERATOR_ROLES = ['水质检验人', '值班管理员', '访客'] as const

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '当班检验员',
    role: '水质检验人' as string,
    shiftLabel: '白班 08:00-20:00',
    scope: '制药企业洁净区与批生产记录管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: string) {
      this.role = role
    },
  },
})
