import { defineStore } from 'pinia'

// 岗位清单：导出等敏感动作按岗位放行，越权直接拒绝。
export const POSTS = ['水质检验员', '值班管理员', 'QA 主管'] as const

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '李检验',
    post: POSTS[0] as string,
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
    setPost(post: string) {
      this.post = post
    },
  },
})
