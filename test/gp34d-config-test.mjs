import fs from 'node:fs'
import { spawn } from 'node:child_process'
const body = fs.readFileSync(process.env.GP_SRC || new URL('../host.js', import.meta.url).pathname, 'utf8')
function runShell(spec) {
  return new Promise((res) => {
    const c = spawn('sh', ['-c', spec.command], { cwd: spec.workdir, env: process.env })
    let o = '', e = ''
    c.stdout.on('data', b => o += b); c.stderr.on('data', b => e += b)
    c.on('error', er => res({ exitCode: null, stdout: { text: o }, stderr: { text: String(er.message) } }))
    c.on('close', x => res({ exitCode: x, stdout: { text: o }, stderr: { text: e } }))
  })
}
const files = new Map()
const dirs = new Set()
const fsService = {
  async resolve(path) { return { path } },
  async stat(t) { return files.has(t.path) ? { kind: 'file' } : (dirs.has(t.path) ? { kind: 'dir' } : undefined) },
  async readText(t) { if (!files.has(t.path)) throw new Error('ENOENT'); return files.get(t.path) },
  async writeText(t, content) { files.set(t.path, content); return { ok: true } },
}
const handlers = new Map()
const ctx = { get: n => (n === 'shell' ? { resolve: r => r, run: runShell } : (n === 'fs' ? fsService : undefined)), effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} } }
const harness = { defineTool: d => d, registerTool: () => () => {}, handle(n, f) { handlers.set(n, f); return () => {} } }
new Function('ctx', 'harness', 'console', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', body)(
  ctx, harness, console, s => Buffer.from(s, 'binary').toString('base64'), s => Buffer.from(s, 'base64').toString('binary'), TextEncoder, TextDecoder).apply(ctx)
const H = n => handlers.get(n)

console.log('== 插件改名后，配置文件也跟着改名 ==')
const first = await H('git/config')({})
console.log('  路径:', first.path)
console.log('  是 dsh-git-idea.json:', String(first.path).indexOf('/dsh-git-idea.json') === 0 ? 'no' : first.path.endsWith('/dsh-git-idea.json'))
console.log('  不再叫 gitops.json:', first.path.indexOf('gitops.json') < 0)
console.log('  默认值:', JSON.stringify(first.config))

const saved = await H('git/config-save')({ config: { initBranch: 'develop', cherryPickRecord: true } })
console.log('  保存:', saved.ok, JSON.stringify(saved.config))
console.log('  落到了新文件:', JSON.stringify(Array.from(files.keys())))
const again = await H('git/config')({})
console.log('  再读一致:', JSON.stringify(again.config) === JSON.stringify(saved.config))

console.log('')
console.log('== 脏输入仍然被清洗 ==')
for (const [label, raw] of [['null', null], ['字符串', 'x'], ['类型错', { initBranch: 42, cherryPickRecord: 'yes' }]]) {
  const out = await H('git/config-save')({ config: raw })
  console.log('  ' + label.padEnd(8), JSON.stringify(out.config))
}
