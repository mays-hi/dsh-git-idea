import fs from 'node:fs'
import { spawn } from 'node:child_process'
const bridge = fs.readFileSync('/home/mayou/.dsh/gitops/host.js', 'utf8')
function runShell(spec) {
  return new Promise((res) => {
    const c = spawn('sh', ['-c', spec.command], { cwd: spec.workdir, env: process.env })
    let o = '', e = ''
    c.stdout.on('data', b => o += b); c.stderr.on('data', b => e += b)
    c.on('close', x => res({ exitCode: x, stdout: { text: o }, stderr: { text: e } }))
  })
}
const handlers = new Map(); const tools = []
const ctx = { get: n => (n === 'shell' ? { resolve: r => r, run: runShell } : undefined), effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} } }
const harness = { handle(n, f) { handlers.set(n, f); return () => {} }, defineTool: d => d, registerTool: (c, d) => { tools.push(d.name); return () => {} } }
new Function('ctx', 'harness', 'console', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', bridge)(ctx, harness, console, s => Buffer.from(s, 'binary').toString('base64'), s => Buffer.from(s, 'base64').toString('binary'), TextEncoder, TextDecoder).apply(ctx)
const R = '/tmp/gp34-repo'
const b = await handlers.get('git/branches')({ repo: R })
console.log('工具:', tools.length, ' RPC:', handlers.size)
console.log('分支:', b.branches.map(x => x.name + (x.current ? '*' : '') + (x.upstream ? '(' + x.upstream + ' ↗' + x.ahead + '↙' + x.behind + ')' : '')).join(', '))
console.log('远端:', b.remotes.map(x => x.remote + '/' + x.name).join(', '))
console.log('previous:', b.previous)
