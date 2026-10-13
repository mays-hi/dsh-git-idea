/* ── 主机侧 RPC 冷/热耗时，以及每一条读起了几个真 git 子进程 ──

   跑法：node test/bench-rpc.mjs <仓库路径> [仓库路径...]
   仓库路径是参数，不写死在任何一台机器上；没有参数时只打印用法。

   每个仓库先 flush 一次，逐个量第一条（冷）与第二条（热）的耗时 —— 冷的那条就是切
   工作区时用户看到的那一段 —— 并数出每条读起了几个子进程：热的那条是 0，就说明这一份
   读数真的命中了 Host 的缓存（缓存见 60-reads.js 的 `cached`）。

   这是原来那几支一次性探针（gp35-perf / gp35-perf2 / gp36-coldwarm）的合并版：它们量的
   是同一件事，只是各自把仓库路径写死在量的人那台机器上；子进程计数来自 gp36-coldwarm。 */

import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { spawn } from 'node:child_process'

const body = fs.readFileSync(fileURLToPath(new URL('../host.js', import.meta.url)), 'utf8')

/* 每一次 shell.run 就是一次真实的子进程 —— 缓存有没有生效，看这个数最直接。 */
let spawns = 0
function runShell(spec) {
  spawns += 1
  return new Promise((res) => {
    const c = spawn('sh', ['-c', spec.command], { cwd: spec.workdir, env: process.env })
    /* 同 gp34e：git 输出的提交信息、路径都可能是多字节，按 chunk 拼 Buffer 会拆坏它们。 */
    c.stdout.setEncoding('utf8')
    c.stderr.setEncoding('utf8')
    let o = '', e = ''
    c.stdout.on('data', (b) => { o += b })
    c.stderr.on('data', (b) => { e += b })
    c.on('error', (er) => res({ exitCode: null, stdout: { text: o }, stderr: { text: String(er.message) } }))
    c.on('close', (x) => res({ exitCode: x, stdout: { text: o }, stderr: { text: e } }))
  })
}

const handlers = new Map()
const ctx = {
  get: (n) => (n === 'shell' ? { resolve: (r) => r, run: runShell } : undefined),
  effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
}
/* harness 现在只有 handle：这个插件不注册工具（见 gp34a 那段断言）。 */
const harness = { handle(n, f) { handlers.set(n, f); return () => {} } }
new Function('ctx', 'harness', 'console', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', body)(
  ctx, harness, console, (s) => Buffer.from(s, 'binary').toString('base64'),
  (s) => Buffer.from(s, 'base64').toString('binary'), TextEncoder, TextDecoder).apply(ctx)

const H = (n) => handlers.get(n)
const REPOS = process.argv.slice(2)
if (REPOS.length === 0) {
  console.error('用法: node test/bench-rpc.mjs <仓库路径> [仓库路径...]')
  process.exit(1)
}

/* 面板打开时会发出去的请求，顺序就是它们各自 effect 的触发顺序 */
const CALLS = [
  ['git/panel', { quick: true }],
  ['git/panel', {}],
  ['git/branches', {}],
  ['git/refs', {}],
  ['git/graph', { maxCount: 200 }],
  ['git/authors', {}],
  ['git/watch', {}],
  ['git/watch', { deep: true }],
]

for (const repo of REPOS) {
  if (!fs.existsSync(repo + '/.git')) { console.log('跳过（不是仓库）: ' + repo); continue }
  console.log('')
  console.log('== ' + repo + ' ==')
  let coldTotal = 0
  let warmTotal = 0
  for (const [method, extra] of CALLS) {
    await H('git/flush')(Object.assign({ repo }, extra))
    spawns = 0
    const t0 = process.hrtime.bigint()
    const cold = await H(method)(Object.assign({ repo }, extra))
    const coldMs = Number(process.hrtime.bigint() - t0) / 1e6
    const coldSpawns = spawns
    spawns = 0
    const t1 = process.hrtime.bigint()
    await H(method)(Object.assign({ repo }, extra))
    const warmMs = Number(process.hrtime.bigint() - t1) / 1e6
    const warmSpawns = spawns
    coldTotal += coldMs
    warmTotal += warmMs
    const label = method === 'git/watch' && extra.deep === true ? 'git/watch[deep]' : method
    const size = method === 'git/graph' ? String((cold.commits || []).length) + ' 提交'
      : method === 'git/branches' ? String((cold.branches || []).length) + ' 分支'
        : method === 'git/authors' ? String((cold.authors || []).length) + ' 作者'
          : method === 'git/refs' ? String((cold.local || []).length) + ' 本地引用' : ''
    console.log('  ' + label.padEnd(16)
      + coldMs.toFixed(1).padStart(8) + 'ms 冷（' + String(coldSpawns) + ' 个子进程）'
      + warmMs.toFixed(1).padStart(8) + 'ms 热（' + String(warmSpawns) + ' 个子进程）   ' + size)
  }
  console.log('  ' + '合计'.padEnd(14) + coldTotal.toFixed(1).padStart(8) + 'ms 冷   ' + warmTotal.toFixed(1).padStart(7) + 'ms 热')
}
