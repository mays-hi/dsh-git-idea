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
const handlers = new Map()
const ctx = {
  get: n => (n === 'shell' ? { resolve: r => r, run: runShell } : undefined),
  effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
}
const harness = { defineTool: d => d, registerTool: () => () => {}, handle(n, f) { handlers.set(n, f); return () => {} } }
new Function('ctx', 'harness', 'console', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', body)(
  ctx, harness, console, s => Buffer.from(s, 'binary').toString('base64'),
  s => Buffer.from(s, 'base64').toString('binary'), TextEncoder, TextDecoder).apply(ctx)
const H = n => handlers.get(n)

function sh(cmd, cwd) {
  return new Promise((res) => {
    const c = spawn('sh', ['-c', cmd], { cwd })
    let o = '', e = ''
    c.stdout.on('data', b => o += b); c.stderr.on('data', b => e += b)
    c.on('close', x => res({ code: x, out: o, err: e }))
  })
}

const R = '/tmp/gp34-repo'
const O = '/tmp/gp34-origin'
await sh(`rm -rf ${R} ${O} && mkdir -p ${R} && cd ${R} && git init -q -b main && git config user.email t@t && git config user.name T && echo a > a.txt && git add -A && git commit -qm first && git clone -q --bare . ${O} && git remote add origin ${O} && git push -q -u origin main`, '/tmp')
const dated = (n, cmd) => `GIT_COMMITTER_DATE="2020-01-0${n}T00:00:00" GIT_AUTHOR_DATE="2020-01-0${n}T00:00:00" ${cmd}`
await sh(`git checkout -q -b ahead-one && git push -q -u origin ahead-one && ${dated(3, 'git commit -q --allow-empty -m "ahead tip"')}`, R)
await sh(`git checkout -q -b behind-one && git push -q -u origin behind-one && git checkout -q main && ${dated(4, 'git commit -q --allow-empty -m "main tip"')} && git push -q origin main && git checkout -q behind-one && git reset -q --hard HEAD~1`, R)
await sh(`git checkout -q main && git checkout -q -b local-only && ${dated(2, 'git commit -q --allow-empty -m "local tip"')}`, R)
await sh(`git push -q origin main:remote-only`, R)
await sh(`git fetch -q origin`, R)
await sh(`git checkout -q main`, R)

const r = await H('git/branches')({ repo: R })
console.log('=== 数字领先/落后 ===')
for (const b of r.branches) {
  console.log('  ' + b.name.padEnd(12), 'track=' + (b.track || '-').padEnd(3), 'ahead=' + String(b.ahead).padEnd(3), 'behind=' + String(b.behind).padEnd(3), 'upstream=' + (b.upstream || '-'))
}
const ahead = r.branches.find(b => b.name === 'ahead-one')
const behind = r.branches.find(b => b.name === 'behind-one')
const main = r.branches.find(b => b.name === 'main')
console.log('  ahead-one 领先 1:', ahead.ahead === 1 && ahead.behind === 0, ' track 符号 >:', ahead.track === '>')
console.log('  behind-one 落后 1:', behind.behind === 1 && behind.ahead === 0, ' track 符号 <:', behind.track === '<')
console.log('  main 与上游一致:', main.ahead === 0 && main.behind === 0 && main.track === '=')
console.log('  local-only 没有上游:', r.branches.find(b => b.name === 'local-only').upstream === '')

console.log('')
console.log('=== 远端分支（本地已同名的剔除）===')
console.log('  remotes:', JSON.stringify(r.remotes.map(x => x.name + '@' + x.remote)))
console.log('  有 remote-only:', r.remotes.some(x => x.name === 'remote-only' && x.remote === 'origin'))
console.log('  没有重复的 main:', r.remotes.every(x => x.name !== 'main'))
console.log('  没有重复的 ahead-one:', r.remotes.every(x => x.name !== 'ahead-one'))
console.log('  current/previous:', r.current, '/', r.previous)

console.log('')
console.log('=== 检出远端分支（DWIM 建本地）===')
const sw = await H('git/checkout')({ repo: R, name: 'remote-only' })
const head = await sh('git rev-parse --abbrev-ref HEAD', R)
const up = await sh('git rev-parse --abbrev-ref --symbolic-full-name @{u}', R)
console.log('  ok =', sw.ok, ' 现在在 =', head.out.trim(), ' 上游 =', up.out.trim())
console.log('  切完列表里 local 有了、remote 里没了:')
const after = await H('git/branches')({ repo: R })
console.log('   ', after.branches.some(b => b.name === 'remote-only'), after.remotes.some(x => x.name === 'remote-only'))

console.log('')
console.log('=== 排序与字段没坏 ===')
const stamps = r.branches.map(b => b.committedAt)
console.log('  按最近提交倒序:', stamps.every((v, i) => i === 0 || stamps[i - 1] >= v))
console.log('  每行都有 head/subject:', r.branches.every(b => typeof b.head === 'string' && typeof b.subject === 'string'))

console.log('')
console.log('=== 非仓库 / 缓存 ===')
const bad = await H('git/branches')({ repo: '/tmp/gp34-nope' })
console.log('  不存在:', bad.ok, bad.error, JSON.stringify(bad.remotes))
await H('git/flush')({ repo: R })
const t0 = Date.now(); await H('git/branches')({ repo: R }); const cold = Date.now() - t0
const t1 = Date.now(); await H('git/branches')({ repo: R }); const hot = Date.now() - t1
console.log('  冷/热 =', cold + 'ms/' + hot + 'ms')

console.log('')
console.log('=== 繁体/中文 locale 下数字仍然正确 ===')
const env = Object.assign({}, process.env, { LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8' })
const r2 = await new Promise((res) => {
  const c = spawn('sh', ['-c', 'git for-each-ref "--format=%(refname:short) %(upstream:track)" refs/heads'], { cwd: R, env })
  let o = ''; c.stdout.on('data', b => o += b); c.on('close', () => res(o))
})
console.log('  同一台机器上 git 的原话:', JSON.stringify(r2.trim().split('\n').filter(l => l.indexOf('ahead-one') === 0 || l.indexOf('behind-one') === 0)))
await H('git/flush')({ repo: R })
const r3 = await H('git/branches')({ repo: R })
console.log('  固定 locale 后仍然 ahead=1:', r3.branches.find(b => b.name === 'ahead-one').ahead === 1, ' behind=1:', r3.branches.find(b => b.name === 'behind-one').behind === 1)

console.log('')
console.log('=== 搜索：字面量 / 正则 / 大小写 ===')
const S = '/tmp/gp40-search'
await sh('rm -rf ' + S + ' && mkdir -p ' + S, '/tmp')
await sh('git init -q . && git config user.email t@t && git config user.name t', S)
const MSGS = ['Fix the parser', 'fix the lexer', 'REFACTOR: parser', 'unrelated']
for (const m of MSGS) {
  await sh('echo x >> f.txt && git add -A', S)
  await sh('git commit -qm ' + JSON.stringify(m), S)
}
const graph = async (args) => { await H('git/flush')({ repo: S }); return await H('git/graph')(Object.assign({ repo: S }, args)) }
const literal = await graph({ search: 'parser' })
const caret = await graph({ search: '^fix' })
const reAny = await graph({ search: '^fix', regex: true })
const reCase = await graph({ search: '^fix', regex: true, caseSensitive: true })
const msgsOf = (g) => g.commits.map((c) => c.subject).join(' | ')
console.log('  字面量 parser        →', literal.commits.length, msgsOf(literal))
console.log('  字面量 ^fix（原样）  →', caret.commits.length, msgsOf(caret))
console.log('  正则 ^fix 忽略大小写 →', reAny.commits.length, msgsOf(reAny))
console.log('  正则 ^fix 区分大小写 →', reCase.commits.length, msgsOf(reCase))
let searchOk = true
const check = (label, value) => { if (value !== true) searchOk = false; console.log('  ' + (value ? '✓' : '✗') + ' ' + label) }
check('默认仍是字面量 + 忽略大小写', literal.commits.length === 2 && caret.commits.length === 0)
check('正则开关生效', reAny.commits.length === 2)
check('大小写开关生效', reCase.commits.length === 1 && reCase.commits[0].subject === 'fix the lexer')
if (searchOk !== true) process.exit(1)
