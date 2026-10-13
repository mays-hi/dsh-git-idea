import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
const bridge = fs.readFileSync(fileURLToPath(new URL('./gp34-bridge-host.js', import.meta.url)), 'utf8')
function runShell(spec) {
  return new Promise((res) => {
    /* DSH_HOME 不在这里改：桥就是靠它去找插件源码的。这个套件读的配置因此是真机上那份，
       但它只断言 git/branches 这一条读，不受插件设置影响。 */
    const c = spawn('sh', ['-c', spec.command], { cwd: spec.workdir, env: process.env })
    /* setEncoding 而不是把 Buffer 直接拼起来：这个套件读的是整个源文件，而源文件里
       全是中文注释，直接拼会把跨 chunk 的三字节字符拆成替换符 —— 读回来的源码和磁盘
       上的因此一直差两个字，「与磁盘一致」也就一直是 false。 */
    c.stdout.setEncoding('utf8')
    c.stderr.setEncoding('utf8')
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
console.log('工具:', tools.length, '（应为 0：这个插件不注册工具） RPC:', handlers.size)
const src = await handlers.get('dsh-git-idea/source')({ half: 'client' })
/* 和这份 checkout 里的 client.js 比，而不是和量的人那台机器上的绝对路径比：
   桥是从 $DSH_HOME/dsh-git-idea 读源码的，这个套件在别的 checkout 里也该给出同一个答案。 */
const clientOnDisk = fs.readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')
console.log('client 源码长度:', src.source.length, ' 与磁盘一致:', src.source === clientOnDisk)
const b = await handlers.get('git/branches')({ repo: '/tmp/gp34-repo' })
console.log('git/branches 仍可用:', b.ok, b.branches.length, '个本地分支')
