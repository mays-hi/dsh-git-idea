import fs from 'node:fs'
import { spawn } from 'node:child_process'
const bridge = fs.readFileSync(new URL('./gp34-bridge-host.js', import.meta.url).pathname, 'utf8')
function runShell(spec) {
  return new Promise((res) => {
    const c = spawn('sh', ['-c', spec.command], { cwd: spec.workdir, env: process.env })
    let o = '', e = ''
    c.stdout.on('data', b => o += b); c.stderr.on('data', b => e += b)
    c.on('close', x => res({ exitCode: x, stdout: { text: o }, stderr: { text: e } }))
  })
}
const handlers = new Map(); const tools = []; const logs = []
const ctx = { get: n => (n === 'shell' ? { resolve: r => r, run: runShell } : undefined), effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} } }
const harness = { handle(n, f) { handlers.set(n, f); return () => {} }, defineTool: d => d, registerTool: (c, d) => { tools.push(d.name); return () => {} } }
new Function('ctx', 'harness', 'console', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', bridge)(ctx, harness, { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) }, s => s, s => s, TextEncoder, TextDecoder).apply(ctx)
await new Promise(r => setTimeout(r, 1200))
console.log('日志:', JSON.stringify(logs))
console.log('工具:', tools.length, ' RPC:', handlers.size)
const src = await handlers.get('dsh-git-idea/source')({ half: 'client' })
console.log('client 源码长度:', src.source.length, ' 与磁盘一致:', src.source === fs.readFileSync('/home/mayou/.dsh/dsh-git-idea/client.js', 'utf8'))
const b = await handlers.get('git/branches')({ repo: '/tmp/gp34-repo' })
console.log('git/branches 仍可用:', b.ok, b.branches.length, '个本地分支')
