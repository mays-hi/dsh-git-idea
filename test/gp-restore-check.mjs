/* 通过恢复后的插件自己的 RPC 做一次真实调用：
   桥装载的 host.js 会把 harness.handle 注册的处理器交出来，
   这里用最小 mock 直接调 git/branches 与 git/panel，证明它真的在跑。 */
import fs from 'node:fs'
import { spawn } from 'node:child_process'
const bridge = fs.readFileSync('/home/mayou/.dsh/gitops/host.js', 'utf8')
function runShell(spec) {
  return new Promise((res) => {
    const c = spawn('sh', ['-c', spec.command], { cwd: spec.workdir, env: process.env })
    let o = '', e = ''
    c.stdout.on('data', b => o += b); c.stderr.on('data', b => e += b)
    c.on('error', er => res({ exitCode: null, stdout: { text: o }, stderr: { text: String(er.message) } }))
    c.on('close', x => res({ exitCode: x, stdout: { text: o }, stderr: { text: e } }))
  })
}
const handlers = new Map()
const tools = []
const ctx = { get: n => (n === 'shell' ? { resolve: r => r, run: runShell } : undefined), effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} } }
const harness = { handle(n, f) { handlers.set(n, f); return () => {} }, defineTool: d => d, registerTool: (c, d) => { tools.push(d.name); return () => {} } }
new Function('ctx', 'harness', 'console', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', bridge)(
  ctx, harness, console, s => Buffer.from(s, 'binary').toString('base64'), s => Buffer.from(s, 'base64').toString('binary'), TextEncoder, TextDecoder).apply(ctx)
const R = '/tmp/gp-restore'
console.log('工具:', JSON.stringify(tools))
console.log('RPC 数:', handlers.size)
const b = await handlers.get('git/branches')({ repo: R })
console.log('git/branches →', b.ok, 'current =', b.current, 'previous =', b.previous, '列表 =', b.branches.map(x => x.name + (x.current ? '(当前)' : '')).join(', '))
console.log('  排序按最近提交:', b.branches.map(x => x.committedAt).every((v, i, a) => i === 0 || a[i - 1] >= v))
const p = await handlers.get('git/panel')({ repo: R })
console.log('git/panel →', p.ok, 'branch =', p.branch, 'clean =', p.staged.length + p.unstaged.length + p.untracked.length === 0)
const sw = await handlers.get('git/checkout')({ repo: R, name: 'feature/two', stash: true })
console.log('git/checkout(stash) →', sw.ok, 'stashed =', sw.stashed, 'dirty =', sw.dirty)
console.log('  现在在:', (await new Promise(r => { const c = spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: R }); let o = ''; c.stdout.on('data', b => o += b); c.on('close', () => r(o.trim())) })))
