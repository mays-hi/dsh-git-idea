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
/* The service object is held by name because the Host half captures it once, at
   apply time (`const shell = ctx.get('shell')`): swapping `ctx.get` later would
   change nothing, so a test that wants to see the command line has to wrap this
   very object's `run`. */
const shellService = { resolve: r => r, run: runShell }
const ctx = {
  get: n => (n === 'shell' ? shellService : undefined),
  effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
}
const TOOLS = new Map()
const harness = { defineTool: d => { TOOLS.set(d.name, d); return d }, registerTool: () => () => {}, handle(n, f) { handlers.set(n, f); return () => {} } }
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
/* 一次都不许静默通过：任何一条 ✗ 都要让这个文件以非 0 退出。之前只有搜索那一段
   会 exit(1)，后面段落里的失败只留一行红字 —— 那样的绿是假的。 */
let failedChecks = 0
const check = (label, value) => {
  if (value !== true) { searchOk = false; failedChecks += 1 }
  console.log('  ' + (value ? '✓' : '✗') + ' ' + label)
}
check('默认仍是字面量 + 忽略大小写', literal.commits.length === 2 && caret.commits.length === 0)
check('正则开关生效', reAny.commits.length === 2)
check('大小写开关生效', reCase.commits.length === 1 && reCase.commits[0].subject === 'fix the lexer')
if (searchOk !== true) process.exit(1)

console.log('')
console.log('=== 分页、廉价身份读、轮询签名 ===')
await H('git/flush')({ repo: S })
const one = await H('git/graph')({ repo: S, maxCount: 1 })
const many = await H('git/graph')({ repo: S, maxCount: 10 })
check('要 1 条就给 1 条，并且说还有更多', one.commits.length === 1 && one.hasMore === true)
check('要的比历史多就全给，并且说没有了', many.commits.length === 4 && many.hasMore === false)
await H('git/flush')({ repo: S })
const ident = await H('git/panel')({ repo: S, quick: true })
const full = await H('git/panel')({ repo: S })
check('身份读给分支、不给工作区（并自报 partial）',
  ident.ok === true && ident.branch !== null && ident.partial === true && ident.staged.length === 0 && ident.untracked.length === 0)
check('完整读给工作区，且不再标 partial', full.ok === true && full.partial === undefined && Array.isArray(full.unstaged))
check('两种读不共用缓存键（先读便宜的不会污染完整读）', ident.partial === true && full.partial === undefined)
const cheap = await H('git/watch')({ repo: S })
const deep = await H('git/watch')({ repo: S, deep: true })
check('轮询签名默认不读工作区', cheap.ok === true && cheap.sig.indexOf('# branch.head') < 0 && cheap.sig.indexOf('F:') >= 0)
check('deep 的轮询才带上工作区状态', deep.sig.indexOf('# branch.head') >= 0)

/* 在终端里（或者 IDEA 里）自己切分支，插件必须看得见 —— 它靠的就是上面这条
   签名。签名里如果只有引用表 + HEAD 的 sha，那「两个分支指向同一个提交」就完全
   看不出来：`git switch -c` 永远是这样，快进合并之后也是这样。 */
console.log('')
console.log('=== 外面自己切分支，轮询签名必须看得见 ===')
const W = '/tmp/gp41-switch'
await sh('rm -rf ' + W + ' && mkdir -p ' + W, '/tmp')
await sh('git init -q -b main . && git config user.email t@t && git config user.name t && echo 1 > a.txt && git add -A && git commit -qm one && echo 2 > b.txt && git add -A && git commit -qm two', W)
await sh('git branch other main~1', W)
const sigOf = async () => (await H('git/watch')({ repo: W })).sig
const sigLine = (sig, key) => (sig.split('\n').find((l) => l.indexOf(key + ':') === 0) || '')

let moved = await sigOf()
await sh('git switch -q other', W)
const afterOther = await sigOf()
console.log('  ' + sigLine(afterOther, 'R'))
check('换到另一个提交上的分支：签名变了', moved !== afterOther)
check('签名里带着当前分支的名字', sigLine(afterOther, 'R').indexOf('ref: refs/heads/other') > 0)
const identAfter = await (async () => { await H('git/flush')({ repo: W }); return await H('git/panel')({ repo: W, quick: true }) })()
check('身份读跟着给出新分支（chip 显示的就是它）', identAfter.branch === 'other')

/* 同一个提交上的两个等长分支名，并且把 HEAD 的时间戳按住不动 —— 也就是
   「同一秒内切换」在签名上留下的全部痕迹。只有 HEAD 文件的内容能分辨它们。 */
await sh('git switch -q main && git branch aa && git branch bb && git switch -q aa', W)
const sameA = await sigOf()
await sh('touch -r .git/index .git/HEAD && git switch -q bb && touch -r .git/index .git/HEAD', W)
const sameB = await sigOf()
console.log('  aa → bb 前后的 R 行：\n    ' + sigLine(sameA, 'R') + '\n    ' + sigLine(sameB, 'R'))
check('同一个提交、等长名字、同一秒：签名仍然变了', sameA !== sameB)

/* `git switch -c` 是最常见的一种：新分支和原分支指向同一个提交。 */
const beforeNew = await sigOf()
await sh('git switch -q -c fresh', W)
const afterNew = await sigOf()
check('git switch -c 新分支（同一个提交）：签名变了', beforeNew !== afterNew)
const detachBefore = await sigOf()
await sh('git switch -q --detach main', W)
const detachAfter = await sigOf()
check('切到游离 HEAD：签名变了', detachBefore !== detachAfter)
await H('git/flush')({ repo: W })
const detached = await H('git/panel')({ repo: W, quick: true })
check('游离 HEAD 时身份读说 detached，chip 显示 HEAD', detached.branch === null && detached.detached === true)

console.log('')
console.log('=== 只认这一个目录：不向上找，也不往里看 ===')
/* 工作区是仓库就在它自己身上：`$dir/.git`（worktree 和子模块那里是个文件）。
   少了这道判断，git 会自己往上找 —— 面板会报出楼上某个仓库的分支，轮询也会跟着
   那个仓库的引用走。 */
const P = '/tmp/gp41-one-dir'
await sh('rm -rf ' + P + ' && mkdir -p ' + P + '/inner/deep', '/tmp')
await sh('git init -q -b main . && git config user.email t@t && git config user.name t && echo x > a.txt && git add -A && git commit -qm one', P)
const panelAt = async (dir) => { await H('git/flush')({ repo: dir }); return await H('git/panel')({ repo: dir, quick: true }) }
const watchAt = async (dir) => (await H('git/watch')({ repo: dir })).sig
const atRoot = await panelAt(P)
const atInner = await panelAt(P + '/inner')
const atDeep = await panelAt(P + '/inner/deep')
console.log('  仓库根目录      :', atRoot.ok === true ? '在 ' + atRoot.branch : atRoot.reason)
console.log('  它的子目录      :', atInner.ok !== true ? atInner.reason : '在 ' + atInner.branch)
check('仓库根目录本身照常是仓库', atRoot.ok === true && atRoot.branch === 'main')
check('仓库的子目录：不认楼上那个仓库', atInner.ok !== true && atInner.reason === 'not-a-repo')
check('再深一层也一样', atDeep.ok !== true && atDeep.reason === 'not-a-repo')
const innerSig = await watchAt(P + '/inner')
console.log('  子目录的轮询签名:', JSON.stringify(innerSig.replace(/\n/g, '|')))
check('子目录的签名里没有楼上仓库的引用', innerSig.indexOf('refs/heads') < 0 && innerSig.indexOf('F:refs') < 0)

/* 反过来：在子目录里自己建一个仓库，它就该被认出来 —— 规则看的是这个目录，
   不是「不许有子目录」 */
await sh('git init -q -b inner . && git config user.email t@t && git config user.name t', P + '/inner')
const innerOwn = await panelAt(P + '/inner')
const innerSig2 = await watchAt(P + '/inner')
check('子目录自己成了仓库，就认它', innerOwn.ok === true && innerOwn.branch === 'inner')
check('而且这时候签名变了（轮询能发现刚 init 的目录）', innerSig !== innerSig2)

/* 空目录 / 随便一个目录：就是「不是仓库」，不再偷看里面有什么 */
const E = '/tmp/gp41-empty'
await sh('rm -rf ' + E + ' && mkdir -p ' + E, '/tmp')
const empty = await panelAt(E)
check('空目录也只是「不是仓库」，没有别的花样', empty.ok !== true && empty.reason === 'not-a-repo')
check('连目录里有什么都不看（脚本里没有 ls）', body.indexOf('ls -A') < 0 && body.indexOf('ls -1') < 0)

console.log('')
console.log('=== 分支树需要的领先/落后 ===')
await H('git/flush')({ repo: R })
const refTree = await H('git/refs')({ repo: R })
const refOf = (n) => refTree.local.find((e) => e.data === n)
const aheadOne = refOf('ahead-one')
const behindOne = refOf('behind-one')
console.log('  ahead-one:', JSON.stringify(aheadOne))
check('refs 带上上游名', aheadOne !== undefined && aheadOne.upstream.length > 0)
check('refs 带上领先/落后', aheadOne.ahead === 1 && behindOne.behind === 1)
check('refs 带上最后提交时间', typeof aheadOne.at === 'number' && aheadOne.at > 0)
if (searchOk !== true) process.exit(1)

console.log('')
console.log('=== 写操作跑在谁的沙箱里 ===')
/* 不带策略的 shell 调用拿到的是**部署默认**（实测：workspace-write，root 是部署
   自己的目录），不是这个会话的策略 —— 实测里会话是 danger-full-access。于是任何
   写操作（git 要建 .git/index.lock）在别的目录上都被拒，而读一切正常。 */
const specs = []
const fakePolicy = { calls: 0, resolve(request) { this.calls += 1; return { mode: 'danger-full-access', workspaceRoot: '/home/mayou/work/dsh-git-map', sessionId: request.session != null ? request.session.id : undefined } } }
const fakeSessions = { get(id) { return id === 's-known' ? { id: id, header: { cwd: '/tmp/gp41-one-dir' } } : null } }
const handlers2 = new Map()
const ctx2 = {
  get: (n) => {
    if (n === 'shell') {
      return {
        resolve: (r) => r,
        run: async (spec) => {
          specs.push(spec)
          /* `git init` first asks whether the path is a directory, and a force
             push with no branch asks which branch is checked out. */
          const text = spec.command.indexOf('echo dir') >= 0 ? 'dir\n' : (spec.command.indexOf('symbolic-ref') >= 0 ? 'main\n' : '')
          return { exitCode: 0, stdout: { text: text }, stderr: { text: '' } }
        },
      }
    }
    if (n === 'sandboxPolicy') return fakePolicy
    if (n === 'sessions') return fakeSessions
    return undefined
  },
  effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
}
const harness2 = { defineTool: d => d, registerTool: () => () => {}, handle(n, f) { handlers2.set(n, f); return () => {} } }
new Function('ctx', 'harness', 'console', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', body)(
  ctx2, harness2, console, s => Buffer.from(s, 'binary').toString('base64'),
  s => Buffer.from(s, 'base64').toString('binary'), TextEncoder, TextDecoder).apply(ctx2)
const H2 = n => handlers2.get(n)

await H2('git/flush')({ repo: '/tmp/gp41-one-dir' })
await H2('git/panel')({ repo: '/tmp/gp41-one-dir', quick: true, sessionId: 's-known' })
const withSession = specs[specs.length - 1].sandboxPolicy
console.log('  带 sessionId 的请求 →', JSON.stringify(withSession))
check('请求带上了那个会话解析出来的沙箱策略',
  withSession !== undefined && withSession.mode === 'danger-full-access' && withSession.sessionId === 's-known')

specs.length = 0
await H2('git/flush')({ repo: '/tmp/gp41-one-dir' })
await H2('git/panel')({ repo: '/tmp/gp41-one-dir', quick: true, sessionId: 's-unknown' })
check('会话找不到时不硬编一个策略（交回 shell 层回落）', specs[specs.length - 1].sandboxPolicy === undefined)

specs.length = 0
await H2('git/flush')({ repo: '/tmp/gp41-one-dir' })
await H2('git/panel')({ repo: '/tmp/gp41-one-dir', quick: true })
check('完全没有 sessionId 时也一样不编', specs[specs.length - 1].sandboxPolicy === undefined)

/* `git init` 是这些 RPC 里唯一自己拼过入参的：它传了 {repo}，sessionId 就掉了，
   于是真正要写 .git 的那条命令拿到的是部署默认策略 —— 一个读得到、却写不进去的
   目录，报回来还是 git 的 "Permission denied"。 */
specs.length = 0
const initReply = await H2('git/init')({ sessionId: 's-known', repo: '/tmp/gp41-one-dir', branch: 'main' })
const initSpec = specs[specs.length - 1]
console.log('  git/init ->', JSON.stringify(specs.map((x) => x.command)), '策略:', JSON.stringify(initSpec.sandboxPolicy))
check('git/init 的写入命令也带着那个会话的策略（它要建 .git）',
  initReply.ok === true && initSpec.sandboxPolicy !== undefined && initSpec.sandboxPolicy.sessionId === 's-known')

/* 被沙箱拒了要和「仓库有问题」分开说 */
specs.length = 0
const previousRun = ctx2.get
const handlers3 = new Map()
const ctx3 = {
  get: (n) => {
    if (n === 'shell') {
      return {
        resolve: (r) => r,
        run: async () => ({ exitCode: 1, stdout: { text: '' }, stderr: { text: "fatal: Unable to create '/x/.git/index.lock': Permission denied" }, sandbox: { mode: 'workspace-write', denied: true } }),
      }
    }
    if (n === 'sandboxPolicy' || n === 'sessions') return undefined
    return undefined
  },
  effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
}
const harness3 = { defineTool: d => d, registerTool: () => () => {}, handle(n, f) { handlers3.set(n, f); return () => {} } }
new Function('ctx', 'harness', 'console', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', body)(
  ctx3, harness3, console, s => Buffer.from(s, 'binary').toString('base64'),
  s => Buffer.from(s, 'base64').toString('binary'), TextEncoder, TextDecoder).apply(ctx3)
const denied = await handlers3.get('git/stage')({ repo: '/x', paths: ['a.txt'] })
console.log('  被拒的答复:', JSON.stringify({ ok: denied.ok, sandboxDenied: denied.sandboxDenied, stderr: denied.stderr.slice(0, 40) }))
check('被沙箱拒绝时答复里明说是沙箱拒绝的', denied.ok !== true && denied.sandboxDenied === true)
check('git 的原话也还在', denied.stderr.indexOf('index.lock') >= 0)

/* ── 读操作不许抢 index.lock ──

   一个 `git status` 会顺手刷新 index 的 stat 缓存 —— 也就是说它会拿
   .git/index.lock。轮询的面板、被并发调用的模型工具，只要撞上别人正在
   `git add`，输的就是别人（"Unable to create index.lock"）。这里的规矩：
   所有读路径都带 --no-optional-locks，读就只是读。

   顺带记一个查错记录：一次 fetch 触发的后台 auto-gc 被当成元凶，但 gc 根本
   不碰 index.lock（它跑的是 pack-objects --indexed-objects，只读 index）。
   会写 index 的只有 index 的写者，而 `git status` 就是其中一个。 */

console.log('')
console.log('=== 读操作不写 index（也就不抢 index.lock）===')
const LOCK = '/tmp/gp34-lock'
await sh(`rm -rf ${LOCK} && mkdir -p ${LOCK} && cd ${LOCK} && git init -q -b main && git config user.email t@t && git config user.name T && seq 1 50 > f && git add f && git commit -qm init`, '/tmp')
const indexStamp = async () => (await sh('stat -c %y .git/index', LOCK)).out.trim()

/* 先把 index 里的 stat 缓存弄过期 —— 不然裸 status 也懒得重写，对照就白测了 */
await sh('touch f', LOCK)
const beforeBare = await indexStamp()
await sh('git status --porcelain >/dev/null', LOCK)
const afterBare = await indexStamp()
check('对照组：裸 git status 确实会重写 index（这个 fixture 能触发它）', beforeBare !== afterBare)

await sh('touch f', LOCK)
const beforePanel = await indexStamp()
await H('git/flush')({ repo: LOCK })
const panelRead = await H('git/panel')({ repo: LOCK })
const afterPanel = await indexStamp()
console.log('  面板完整读取:', panelRead.ok === true ? 'ok' : String(panelRead.error), ' index 有没被动:', beforePanel !== afterPanel)
check('面板的完整读取没有写 index', panelRead.ok === true && beforePanel === afterPanel)

await sh('touch f', LOCK)
const beforeTool = await indexStamp()
const toolRead = await TOOLS.get('git_status').execute({ repo: LOCK }, { agent: { session: { header: { cwd: LOCK } } } })
const afterTool = await indexStamp()
console.log('  git_status 工具:', toolRead.ok === true ? 'ok' : String(toolRead.error), ' index 有没被动:', beforeTool !== afterTool)
check('模型工具 git_status 也没有写 index', toolRead.ok === true && beforeTool === afterTool)

/* 差异读（`git/diff`）照同一套规矩，而且这里只钉能钉住的那一件事。

   先说量到的事实（20 次一组，同一台机器）：裸 `git diff` 在 `touch f` 之后
   **2/20 次**重写了 .git/index，带 `--no-optional-locks` 的 **0/20** 次，而裸
   `git status` 是 **20/20**。也就是说这条读确实会碰 index，但只在少数状态下
   （stat 缓存过期那一类）——所以「跑一次、比 mtime」这种测法本身是不稳的：它
   在带标志时也可能偶尔撞上（本套件在 Node 这一侧见过一次）。能稳定钉住的是
   argv：四种模式发出去的每一条命令，标志都在子命令前面。 */
const diffCommands = []
const realRun = shellService.run
shellService.run = function (spec) { diffCommands.push(spec.command); return realRun(spec) }
await sh("printf 'x\\n' > untr.txt", LOCK)
const lockHead = (await sh('git rev-parse HEAD', LOCK)).out.trim()
await H('git/diff')({ repo: LOCK, mode: 'worktree', path: 'f' })
await H('git/diff')({ repo: LOCK, mode: 'staged', path: 'f' })
await H('git/diff')({ repo: LOCK, mode: 'untracked', path: 'untr.txt' })
await H('git/diff')({ repo: LOCK, mode: 'commit', path: 'f', ref: lockHead })
shellService.run = realRun
console.log('  四种模式的命令:')
for (const cmd of diffCommands) console.log('    ' + cmd)
check('四种模式的命令里都带着 --no-optional-locks，而且在子命令前面',
  diffCommands.length === 4 && diffCommands.every(function (cmd) {
    const at = cmd.indexOf("'--no-optional-locks'")
    return at >= 0 && at < cmd.search(/'diff'|'show'/)
  }))

/* 规矩写死在源码里：以后再加一条读状态的地方，忘了标志就红。
   只认真正的调用行（`git -C …` 的 shell 串，或 `git(args, […])` 的参数表），
   免得把工具描述里那句 "Reads git status --porcelain=v2" 也算进来。 */
const statusLines = body.split('\n').map((l, i) => ({ n: i + 1, l: l }))
  .filter((x) => x.l.indexOf('--porcelain') >= 0 && x.l.indexOf('status') >= 0
    && (x.l.indexOf('git -C') >= 0 || x.l.indexOf('git(args,') >= 0))
const unguarded = statusLines.filter((x) => x.l.indexOf('no-optional-locks') < 0)
console.log('  源码里读状态的调用:', statusLines.length, '条，没带标志的:', unguarded.length)
for (const x of unguarded) console.log('    L' + x.n + ': ' + x.l.trim().slice(0, 80))
check('每一条读状态的 git 调用都带 --no-optional-locks', statusLines.length >= 3 && unguarded.length === 0)


/* ── 值是值，不是选项 ──

   结构化工具把调用方给的字符串直接放进 git 的 argv：一个修订号、一个路径、一个
   远端名、一个分支名。以 "-" 开头的字符串已经不是那个值了 —— git 会把它当选项
   读。实测：`git_sync` 的 branch="--force" 跑出 `git push origin --force`（一次
   没有确认的强推），`git_log` 的 ref="--output=/tmp/x" 把空日志写进那个文件并
   返回空结果，`git_branch` 的 name="--force" 跑出 `git branch --force`。 */
console.log('')
console.log('=== 值是值，不是选项 ===')
const cmds = []
const tools5 = new Map()
const ctx5 = {
  get: (n) => (n === 'shell'
    ? {
      resolve: (r) => r,
      run: async (spec) => {
        cmds.push(spec.command)
        const text = spec.command.indexOf('symbolic-ref') >= 0 ? 'main\n' : ''
        return { exitCode: 0, stdout: { text: text }, stderr: { text: '' } }
      },
    }
    : undefined),
  effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
}
const harness5 = { defineTool: (d) => { tools5.set(d.name, d); return d }, registerTool: () => () => {}, handle: (n, f) => { tools5.set('rpc:' + n, f); return () => {} } }
new Function('ctx', 'harness', 'console', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', body)(
  ctx5, harness5, console, s => Buffer.from(s, 'binary').toString('base64'),
  s => Buffer.from(s, 'base64').toString('binary'), TextEncoder, TextDecoder).apply(ctx5)
const exec5 = { agent: { session: { header: { cwd: '/tmp' } } } }

const refuses = async (label, name, args) => {
  cmds.length = 0
  const out = await tools5.get(name).execute(args, exec5)
  console.log('  ' + label.padEnd(34) + ' -> error=' + String(out.error) + ' blocked=' + String(out.blocked) + ' 发出的命令=' + String(cmds.length))
  return out
}
const logOpt = await refuses('git_log ref=--output=/tmp/gp41-zzz', 'git_log', { repo: '/tmp', ref: '--output=/tmp/gp41-zzz' })
check('以 - 开头的 revision 被拒，且一个进程都没起', logOpt.ok !== true && logOpt.error === 'option-like-value' && cmds.length === 0)
const syncOpt = await refuses('git_sync push branch=--force', 'git_sync', { action: 'push', remote: 'origin', branch: '--force' })
check('以 - 开头的分支名被拒（否则就是一次没确认的强推）', syncOpt.ok !== true && syncOpt.error === 'option-like-value' && cmds.length === 0)
const branchOpt = await refuses('git_branch create name=--force', 'git_branch', { action: 'create', name: '--force' })
check('以 - 开头的分支名在 git_branch 里也被拒', branchOpt.ok !== true && branchOpt.error === 'option-like-value' && cmds.length === 0)
/* `--` 之后是路径：一个叫 `-notes.txt` 的文件是正当名字，不能被顺手一起拒掉。 */
cmds.length = 0
const dottedPath = await tools5.get('git').execute({ args: ['log', '--', '-notes.txt'] }, exec5)
check('`--` 后面的路径不受这条规矩影响', cmds.length === 1 && String(cmds[0]).indexOf("'--' '-notes.txt'") > 0)

/* 保护分支的三种写法是同一个引用：只有最长的那一种被认出来时，规则看着还在，
   而它点名的那个分支已经过去了。 */
console.log('')
const protectedRefs = [
  ['git push -f origin refs/heads/main', ['push', '-f', 'origin', 'refs/heads/main'], 'forbidden'],
  ['git push -f origin heads/main', ['push', '-f', 'origin', 'heads/main'], 'forbidden'],
  ['git push -f origin main', ['push', '-f', 'origin', 'main'], 'forbidden'],
  ['git push -f origin refs/heads/topic', ['push', '-f', 'origin', 'refs/heads/topic'], 'confirmation-required'],
]
for (const [label, argv, want] of protectedRefs) {
  const out = await tools5.get('git').execute({ args: argv }, exec5)
  console.log('  ' + label.padEnd(38) + ' -> blocked=' + String(out.blocked))
  check(label + ' → ' + want, out.blocked === want)
}
/* 不带分支的强推推的是「当前分支」，而当前分支同样可能是 main。 */
const forceNoBranch = await tools5.get('git_sync').execute({ action: 'push', force: 'force', confirm: true }, exec5)
console.log('  git_sync force + confirm，不给分支（当前分支 main） -> blocked=' + String(forceNoBranch.blocked))
check('不给分支的强推也要看当前分支是不是保护分支', forceNoBranch.blocked === 'forbidden')

/* 空参数那条路是唯一没有 stdout 的答复，渲染器不能因此炸掉。 */
console.log('')
const emptyArgs = await tools5.get('git').execute({ args: [] }, exec5)
let rendered = ''
try { rendered = JSON.stringify(tools5.get('git').output.render({}, emptyArgs)) } catch (error) { rendered = 'threw: ' + String(error) }
console.log('  空参数渲染 ->', JSON.stringify(rendered))
check('空参数被拒之后，渲染器照常给出理由', rendered.indexOf('INVALID ARGUMENTS') >= 0 && rendered.indexOf('threw') < 0)

/* 身份读（chip 用的那个廉价读）自己也要报数，而且未出生的分支也要认名字。 */
console.log('')
console.log('=== 身份读：报数、认未出生的分支 ===')
await sh('git switch -q ahead-one', R)
await H('git/flush')({ repo: R })
const identAhead = await H('git/panel')({ repo: R, quick: true })
console.log('  ahead-one:', JSON.stringify({ branch: identAhead.branch, upstream: identAhead.upstream, ahead: identAhead.ahead, behind: identAhead.behind }))
check('身份读给出领先数（locale 固定，词是英文）',
  identAhead.ok === true && identAhead.branch === 'ahead-one' && identAhead.upstream === 'origin/ahead-one' && identAhead.ahead === 1 && identAhead.behind === 0)
await sh('git switch -q behind-one', R)
await H('git/flush')({ repo: R })
const identBehind = await H('git/panel')({ repo: R, quick: true })
check('身份读给出落后数', identBehind.branch === 'behind-one' && identBehind.behind === 1 && identBehind.ahead === 0)
await sh('git switch -q main', R)

const UNBORN = '/tmp/gp41-unborn'
await sh('rm -rf ' + UNBORN + ' && mkdir -p ' + UNBORN, '/tmp')
await sh('git init -q -b trunk .', UNBORN)
await H('git/flush')({ repo: UNBORN })
const unborn = await H('git/panel')({ repo: UNBORN, quick: true })
console.log('  未出生分支:', JSON.stringify({ branch: unborn.branch, detached: unborn.detached, ok: unborn.ok }))
check('还没有提交的分支，身份读照样报名字（读的是 HEAD 文件本身）',
  unborn.ok === true && unborn.branch === 'trunk' && unborn.detached === false)

/* ── 一个文件的差异 ──
   面板能说「哪个文件改了」很久了，但没有任何一次读取返回过 patch，所以两处的
   文件行都到那里为止。这一节盯的就是补上的那次读取：四种状态各自的形状。 */

console.log('')
console.log('=== 差异读：四种状态 ===')
const D = '/tmp/gp42-diffrepo'
await sh('rm -rf ' + D + ' && mkdir -p ' + D + ' && cd ' + D + ' && git init -q -b main .'
  + " && git config user.email t@t && git config user.name T"
  + " && printf 'one\\ntwo\\nthree\\n' > a.txt && git add -A && git commit -qm one", '/tmp')

const rootHash = (await sh('git rev-parse HEAD', D)).out.trim()
const rootDiff = await H('git/diff')({ repo: D, mode: 'commit', path: 'a.txt', ref: rootHash })
check('根提交也读得出来（它没有父提交）',
  rootDiff.ok === true && rootDiff.added === 3 && rootDiff.removed === 0 && rootDiff.text.indexOf('new file mode') > 0)

await sh("printf 'one\\ntwo changed\\nthree\\n' > a.txt && git add a.txt"
  + " && printf 'one\\ntwo changed\\nthree\\nfour\\n' > a.txt", D)
const stagedDiff = await H('git/diff')({ repo: D, mode: 'staged', path: 'a.txt' })
const worktreeDiff = await H('git/diff')({ repo: D, mode: 'worktree', path: 'a.txt' })
check('已暂存那一段：+1 −1，数的是改动行不是文件头',
  stagedDiff.ok === true && stagedDiff.added === 1 && stagedDiff.removed === 1
  && stagedDiff.text.indexOf('+two changed') > 0 && stagedDiff.text.indexOf('+++ b/a.txt') > 0)
check('未暂存那一段：+1 −0（同一个文件，两种状态）',
  worktreeDiff.ok === true && worktreeDiff.added === 1 && worktreeDiff.removed === 0
  && worktreeDiff.text.indexOf('+four') > 0)

await sh("printf 'brand new\\n' > n.txt", D)
const untrackedDiff = await H('git/diff')({ repo: D, mode: 'untracked', path: 'n.txt' })
check('未跟踪：--no-index 的退出码是 1，但补丁本身是好的',
  untrackedDiff.ok === true && untrackedDiff.added === 1 && untrackedDiff.text.indexOf('new file mode') > 0)

console.log('')
console.log('  — 守卫 —')
const absPath = await H('git/diff')({ repo: D, mode: 'untracked', path: '/etc/hostname' })
console.log('  绝对路径 ->', JSON.stringify(absPath))
check('绝对路径被拒（--no-index 会真的去读仓库外的文件）',
  absPath.ok === false && absPath.error === 'invalid-path')
/* 对照：同一个命令绕过守卫，读的就是仓库外的文件 —— 守卫是承重的，不是装饰 */
const rawEscape = await sh('cd ' + D + ' && git --no-optional-locks diff --no-color --no-index -- /dev/null /etc/hostname | head -1', '/tmp')
check('（对照）同一条 git 命令绕过守卫确实会读出 /etc/hostname',
  rawEscape.out.indexOf('/etc/hostname') >= 0)
check('.. 被拒', (await H('git/diff')({ repo: D, mode: 'worktree', path: '../x' })).error === 'invalid-path')
check('未知 mode 被拒', (await H('git/diff')({ repo: D, mode: 'nope', path: 'a.txt' })).error === 'unknown-mode')
check('commit 模式必须给哈希（选项串也过不去）',
  (await H('git/diff')({ repo: D, mode: 'commit', path: 'a.txt', ref: '--output=/tmp/x' })).error === 'invalid-ref')

console.log('')
console.log('  — 不是文本的，不作文本 —')
await sh("printf 'a\\000b' > c.bin && git add c.bin", D)
const nulBinary = await H('git/diff')({ repo: D, mode: 'staged', path: 'c.bin' })
check('带 NUL 的二进制：只说二进制，不给正文',
  nulBinary.ok === true && nulBinary.binary === true && nulBinary.text.length === 0)
/* git 只在头 8000 字节里找 NUL，所以没有 NUL 的二进制会被当成文本印出来 */
await sh("head -c 400 /dev/urandom | tr -d '\\000' > r.bin", D)
const noisyBinary = await H('git/diff')({ repo: D, mode: 'untracked', path: 'r.bin' })
check('没有 NUL 的二进制也不当文本（否则面板里是一屏噪声）',
  noisyBinary.ok === true && noisyBinary.binary === true && noisyBinary.text.length === 0)

const cleanDiff = await H('git/diff')({ repo: D, mode: 'worktree', path: 'c.bin' })
check('没有差异时是空补丁，不是错误', cleanDiff.ok === true && cleanDiff.empty === true && cleanDiff.text === '')

await sh('for i in $(seq 1 7000); do echo "l$i" >> big.txt; done', D)
const bigDiff = await H('git/diff')({ repo: D, mode: 'untracked', path: 'big.txt' })
console.log('  超长补丁:', JSON.stringify({ truncated: bigDiff.truncated, lines: bigDiff.text.split('\n').length }))
check('超长补丁截断并自报截断', bigDiff.ok === true && bigDiff.truncated === true && bigDiff.text.split('\n').length <= 6000)

await sh("printf 'x\\n' > ./-dash.txt", D)
const dashDiff = await H('git/diff')({ repo: D, mode: 'untracked', path: '-dash.txt' })
check('以 - 开头的文件名照样当路径（-- 之后都是路径）', dashDiff.ok === true && dashDiff.added === 1)

console.log('')
console.log('  — 提交：重命名与合并 —')
await sh('git add -A && git commit -qm two && git mv a.txt renamed.txt && git commit -qm rename', D)
const renameHash = (await sh('git rev-parse HEAD', D)).out.trim()
const renamed = await H('git/diff')({ repo: D, mode: 'commit', path: 'renamed.txt', from: 'a.txt', ref: renameHash })
const renamedOnly = await H('git/diff')({ repo: D, mode: 'commit', path: 'renamed.txt', ref: renameHash })
check('带上旧路径才认得出是一次重命名', renamed.ok === true && renamed.text.indexOf('rename from a.txt') > 0)
check('（对照）只给新路径，git 报成新增', renamedOnly.text.indexOf('new file mode') > 0 && renamedOnly.text.indexOf('rename from') < 0)

await sh('git checkout -q -b side HEAD~1 && echo s > s.txt && git add s.txt && git commit -qm side'
  + ' && git checkout -q main && git merge -q --no-edit side', D)
const mergeHash = (await sh('git rev-parse HEAD', D)).out.trim()
const parentFields = (await sh('git rev-list --parents -n1 ' + mergeHash + ' | wc -w', D)).out.trim()
const mergedDiff = await H('git/diff')({ repo: D, mode: 'commit', path: 's.txt', ref: mergeHash })
console.log('  合并提交:', JSON.stringify({ parents: parentFields, added: mergedDiff.added, empty: mergedDiff.empty }))
check('这确实是合并提交（三个字段：自己 + 两个父）', parentFields === '3')
check('合并读的是第一父提交的差异（不加 -m 的话组合差异是空的）',
  mergedDiff.ok === true && mergedDiff.added === 1 && mergedDiff.text.indexOf('+s') > 0)

console.log('')
console.log('  — 差异不缓存 —')
await H('git/flush')({ repo: D })
const beforeEdit = await H('git/diff')({ repo: D, mode: 'worktree', path: 's.txt' })
await sh("printf 's\\nchanged\\n' > s.txt", D)
const afterEdit = await H('git/diff')({ repo: D, mode: 'worktree', path: 's.txt' })
check('改完再读就是新的（这是给正在看的那个人读的文本）',
  beforeEdit.empty === true && afterEdit.added === 1 && afterEdit.text.indexOf('+changed') > 0)

/* ── 未跟踪目录里有什么 ──
   git 把未跟踪目录折叠成一行（路径以 / 结尾），不说里面有什么。勾选整行不需要
   答案；展开它是一次单独的读，`ls-files --others --exclude-standard` 列的正是
   `git add <dir>` 会收的那些，.gitignore 同样生效。 */

console.log('')
console.log('=== 未跟踪目录里有什么 ===')
await sh("mkdir -p newdir/deep && printf 'a\\n' > newdir/a.txt && printf 'b\\n' > newdir/deep/b.txt"
  + " && printf 'c\\n' > newdir/c.bin && printf '*.log\\n' > .gitignore && printf 'x\\n' > newdir/skip.log", D)

const listed = await H('git/untracked')({ repo: D, dir: 'newdir/' })
console.log('  目录里:', JSON.stringify(listed.files))
check('列出的是 git add <dir> 会收的那些文件（递归）',
  listed.ok === true && listed.files.length === 3
  && listed.files.indexOf('newdir/a.txt') >= 0 && listed.files.indexOf('newdir/deep/b.txt') >= 0
  && listed.files.indexOf('newdir/c.bin') >= 0)
check('被 .gitignore 排除的不在其中', listed.files.indexOf('newdir/skip.log') < 0)

/* 对照：面板那一次读对同一个目录只有一行，没有内容 —— 展开是另一件事 */
await H('git/flush')({ repo: D })
const panelWithDir = await H('git/panel')({ repo: D })
const collapsedRows = panelWithDir.untracked.filter(function (x) { return String(x.path).indexOf('newdir/') === 0 })
console.log('  面板读里这个目录:', JSON.stringify(collapsedRows))
check('（对照）面板那一次读只给一行、末尾带斜杠、没有内容',
  collapsedRows.length === 1 && collapsedRows[0].path === 'newdir/')

const dirEscape = await H('git/untracked')({ repo: D, dir: '../../etc' })
check('目录同样不许跑出仓库', dirEscape.ok === false && dirEscape.error === 'invalid-path')

const insideDiff = await H('git/diff')({ repo: D, mode: 'untracked', path: 'newdir/a.txt' })
check('目录里的文件照样读得出差异', insideDiff.ok === true && insideDiff.added === 1)

/* 前面任何一条 ✗ 都要反映到退出码上 */
if (failedChecks > 0) {
  console.log('')
  console.log('✗ ' + failedChecks + ' 条不符合预期')
  process.exit(1)
}
