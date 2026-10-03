// 打包并运行 scripts/verify.ts：核心流程（迁移/校验/导出/状态机/同步）的回归验证。
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'

const outfile = 'node_modules/.cache/verify.bundle.mjs'

await build({
  entryPoints: ['scripts/verify.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  alias: { '@': './src' },
  outfile,
  logLevel: 'silent',
})

await import(pathToFileURL(outfile).href)
