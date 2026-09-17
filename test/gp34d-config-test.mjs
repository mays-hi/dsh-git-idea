import fs from 'node:fs'
import { spawn } from 'node:child_process'
const body = fs.readFileSync(process.env.GP_SRC || new URL('../host.js', import.meta.url).pathname, 'utf8')
function runShell(spec) {
  return new Promise((res) => {
    const c = spawn('sh', ['-c', spec.command], { cwd: spec.workdir, env: Object.assign({}, process.env, { DSH_HOME: '/tmp/gp34d-home/.dsh', HOME: '/tmp/gp34d-home', GIT_CONFIG_GLOBAL: '/tmp/gp34d-home/.gitconfig', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }) })
    let o = '', e = ''
    c.stdout.on('data', b => o += b); c.stderr.on('data', b => e += b)
    c.on('error', er => res({ exitCode: null, stdout: { text: o }, stderr: { text: String(er.message) } }))
    c.on('close', x => res({ exitCode: x, stdout: { text: o }, stderr: { text: e } }))
  })
}
/* 没有 fs 服务这一项：这份配置文件走 shell（它在任何工作区之外，而文件服务是按工作区
   发策略的 —— 真机上正是这条把它写丢的）。骨架里只给 shell，就说明它不再需要别的东西。 */
const handlers = new Map()
const ctx = { get: n => (n === 'shell' ? { resolve: r => r, run: runShell } : undefined), effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} } }
const harness = { handle(n, f) { handlers.set(n, f); return () => {} } }
new Function('ctx', 'harness', 'console', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', body)(
  ctx, harness, console, s => Buffer.from(s, 'binary').toString('base64'), s => Buffer.from(s, 'base64').toString('binary'), TextEncoder, TextDecoder).apply(ctx)
const H = n => handlers.get(n)

console.log('== 插件改名后，配置文件也跟着改名 ==')
const first = await H('git/config')({})
console.log('  路径:', first.path)
console.log('  是 dsh-git-idea.json:', String(first.path).indexOf('/dsh-git-idea.json') === 0 ? 'no' : first.path.endsWith('/dsh-git-idea.json'))
console.log('  不再叫 gitops.json:', first.path.indexOf('gitops.json') < 0)
console.log('  默认值:', JSON.stringify(first.config))

const IDENT_DIR = '/tmp/gp34d-home/.dsh'
const CONFIG_FILE = IDENT_DIR + '/dsh-git-idea.json'
const saved = await H('git/config-save')({ config: { initBranch: 'develop', cherryPickRecord: true } })
console.log('  保存:', saved.ok, JSON.stringify(saved.config))
console.log('  落在磁盘上的:', CONFIG_FILE, JSON.stringify(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/\s+/g, ' ')))
const again = await H('git/config')({})
console.log('  再读一致:', JSON.stringify(again.config) === JSON.stringify(saved.config))
const guards0 = []
const check0 = (label, value) => {
  if (value !== true) guards0.push(label)
  console.log('  ' + (value ? '✓' : '✗') + ' ' + label)
}
/* 真机上这条曾经安静地什么也没写：文件服务按工作区发策略，而这份文件在任何工作区之外，
   于是写被拒、屏幕上也没有一句话。现在它走 shell，而且断言看的是磁盘上的字节。 */
check0('保存之后磁盘上确实有这份文件（不是只活在内存里）',
  fs.existsSync(CONFIG_FILE) && fs.readFileSync(CONFIG_FILE, 'utf8').indexOf('"initBranch": "develop"') >= 0)
check0('而且没有 fs 服务也能读回来（骨架里只给了 shell）',
  JSON.stringify(again.config) === JSON.stringify(saved.config))
if (guards0.length > 0) process.exit(1)

console.log('')
console.log('== 脏输入仍然被清洗 ==')
for (const [label, raw] of [['null', null], ['字符串', 'x'], ['类型错', { initBranch: 42, cherryPickRecord: 'yes' }]]) {
  const out = await H('git/config-save')({ config: raw })
  console.log('  ' + label.padEnd(8), JSON.stringify(out.config))
}

/* ── 机器上的东西：哪个 git、谁提交 ──

   这一半读写的不是插件自己的配置文件，而是 git 的：`gitPath` 是设置，身份是 git 的
   全局 / 仓库配置。所以这个 fixture 把自己藏起来 —— HOME 和 GIT_CONFIG_GLOBAL 都指到
   /tmp 下面，于是 `git config --global` 写的是这里，而不是跑测试的那个人的 ~/.gitconfig。
   一个字节都不许碰到他自己的配置。 */
const IDENT_HOME = '/tmp/gp34d-home'
const IDENT_GLOBAL = IDENT_HOME + '/.gitconfig'
function sh(cmd, cwd) {
  return new Promise((res) => {
    const c = spawn('sh', ['-c', cmd], {
      cwd: cwd,
      env: Object.assign({}, process.env, {
        /* DSH_HOME 也要压住：它从环境里继承下来，比 HOME 优先 —— 只改 HOME 的话，
           这个套件写的仍然是跑测试那个人的真配置文件。 */
        DSH_HOME: IDENT_HOME + '/.dsh',
        HOME: IDENT_HOME, GIT_CONFIG_GLOBAL: IDENT_GLOBAL, GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      }),
    })
    let o = '', e = ''
    c.stdout.on('data', b => o += b); c.stderr.on('data', b => e += b)
    c.on('close', x => res({ code: x, out: o, err: e }))
  })
}
await sh('rm -rf ' + IDENT_HOME + ' /tmp/gp34d-ident /tmp/gp34d-ident2 && mkdir -p ' + IDENT_HOME + ' /tmp/gp34d-ident /tmp/gp34d-ident2')
await sh('git init -q -b main . && echo a > a.txt && git add -A', '/tmp/gp34d-ident')
await sh('git init -q -b main . && echo b > b.txt && git add -A', '/tmp/gp34d-ident2')
const realGit = (await sh('command -v git')).out.trim()
const guards = []
const check = (label, value) => {
  if (value !== true) guards.push(label)
  console.log('  ' + (value ? '✓' : '✗') + ' ' + label)
}

console.log('')
console.log('== 哪个 git：设置里的路径真的被用了 ==')
const tool0 = await H('git/toolchain')({})
console.log('  默认:', JSON.stringify({ path: tool0.path, version: tool0.version, fromPath: tool0.fromPath, found: tool0.found }))
check('默认读的是 PATH 上的那一个，而且报出版本', tool0.found === true && tool0.fromPath === true && tool0.path === realGit && tool0.version.indexOf('git version') === 0)
const panelBefore = await H('git/panel')({ repo: '/tmp/gp34d-ident' })
check('（对照）默认这一读是好的', panelBefore.ok === true && panelBefore.branch === 'main')

const savedPath = await H('git/config-save')({ config: { gitPath: realGit } })
check('设置里写进一个绝对路径', savedPath.ok === true && savedPath.config.gitPath === realGit)
const tool1 = await H('git/toolchain')({})
check('它成了「用的就是它」，而不是「来自 PATH」', tool1.path === realGit && tool1.fromPath === false && tool1.found === true)
const panelAfter = await H('git/panel')({ repo: '/tmp/gp34d-ident' })
check('面板读照常（换的是命令词，不是行为）', panelAfter.ok === true && panelAfter.branch === 'main')

const badPath = await H('git/config-save')({ config: { gitPath: '/nonexistent/bin/git' } })
check('写一个不存在的路径：设置收下，但检查时说得清是「写的那个不可用」',
  badPath.ok === true && (await H('git/toolchain')({})).found === false
  && (await H('git/toolchain')({})).reason === 'configured-missing')
const panelBad = await H('git/panel')({ repo: '/tmp/gp34d-ident' })
check('这时候面板读说的是「这台机器上没有 git」，而不是「这不是仓库」',
  panelBad.ok !== true && panelBad.reason === 'no-git')
/* 缓存也得作废：上面这两次读的是**同一棵树**（同一个缓存键），所以这一对断言正是
   在说「答案跟着二进制走，而不是跟着上一次那个二进制的缓存走」。 */
const backToGood = await H('git/config-save')({ config: { gitPath: realGit } })
const afterFix = await H('git/panel')({ repo: '/tmp/gp34d-ident' })
check('把路径改回来，同一棵树立刻又读得动了（改 git 会作废缓存）',
  backToGood.ok === true && afterFix.ok === true)
await H('git/config-save')({ config: { gitPath: '' } })

console.log('')
console.log('== 脏路径会被清洗（它要贴在每一条命令前面）==')
for (const [label, raw] of [['换行', '/usr/bin/git\nrm -rf /'], ['前导减号', '-c'], ['制表符', '/usr/bin/\tgit']]) {
  const out = await H('git/config-save')({ config: { gitPath: raw } })
  console.log('  ' + label.padEnd(8), JSON.stringify(out.config.gitPath))
  check('  ' + label + ' 被丢掉（回到默认）', out.config.gitPath === '')
}
const spaced = await H('git/config-save')({ config: { gitPath: '/opt/my git/bin/git' } })
check('带空格的路径留下（引号管得住空格）', spaced.config.gitPath === '/opt/my git/bin/git')
await H('git/config-save')({ config: { gitPath: '' } })

console.log('')
console.log('== 提交身份：读、写、以及不许写的东西 ==')
const empty = await H('git/identity')({ repo: '/tmp/gp34d-ident' })
console.log('  没配时:', JSON.stringify({ needs: empty.needsIdentity, nameMissing: empty.nameMissing, emailMissing: empty.emailMissing, repo: empty.repo }))
check('没配时读出来就是「缺」，而且分得清缺的是名字还是邮箱',
  empty.ok === true && empty.needsIdentity === true && empty.nameMissing === true && empty.emailMissing === true)

const globalWrite = await H('git/identity-save')({ scope: 'global', name: 'Ada Lovelace', email: 'ada@example.com' })
console.log('  写全局:', JSON.stringify({ ok: globalWrite.ok, written: globalWrite.written, name: globalWrite.name, origin: globalWrite.nameOrigin }))
check('写全局：名字和邮箱都写进去了，读回来就是它们',
  globalWrite.ok === true && globalWrite.written.length === 2 && globalWrite.name === 'Ada Lovelace' && globalWrite.email === 'ada@example.com')
check('落点确实是 git 的全局配置文件（不是这个仓库）',
  globalWrite.nameOrigin.indexOf('.gitconfig') >= 0 && fs.readFileSync(IDENT_GLOBAL, 'utf8').indexOf('Ada Lovelace') >= 0)
check('这个仓库的 .git/config 里没有它', (await sh('git config --local --get user.name', '/tmp/gp34d-ident')).out.trim() === '')
const otherRepo = await H('git/identity')({ repo: '/tmp/gp34d-ident2' })
check('另一个仓库也认这份身份（写的是机器级的）', otherRepo.needsIdentity === false && otherRepo.name === 'Ada Lovelace' && otherRepo.nameOrigin.indexOf('.gitconfig') >= 0)

/* 不知道是哪个仓库时：只回答机器级那一份，绝不用「当前目录」的那一份 —— 跑测试的
   目录恰好是个有身份的仓库（插件自己那个），而 `git config` 会从它那儿答出一个不是
   读者的名字。这一条就是被这个 fixture 抓出来的那个 bug。 */
const nowhere = await H('git/identity')({})
console.log('  不知道仓库时:', JSON.stringify({ inside: nowhere.insideRepo, name: nowhere.name, origin: nowhere.nameOrigin }))
check('不知道仓库时不冒充「此刻生效」：名字只能来自那份全局配置',
  nowhere.ok === true && nowhere.insideRepo === false && nowhere.repo === null
  && nowhere.name === 'Ada Lovelace' && nowhere.nameOrigin.indexOf('.gitconfig') >= 0
  && nowhere.needsIdentity === false)

const localWrite = await H('git/identity-save')({ scope: 'local', repo: '/tmp/gp34d-ident', name: 'Repo Only', email: '' })
console.log('  写本地:', JSON.stringify({ ok: localWrite.ok, written: localWrite.written, name: localWrite.name, origin: localWrite.nameOrigin }))
check('写本地：只动了这一个仓库，而且空的邮箱一个字节都没写',
  localWrite.ok === true && localWrite.written.length === 1 && localWrite.written[0] === 'user.name'
  && (await sh('git config --local --get user.name', '/tmp/gp34d-ident')).out.trim() === 'Repo Only'
  && (await sh('git config --local --get user.email', '/tmp/gp34d-ident')).code !== 0)
check('这个仓库现在报的是本地那一份，来源指得出是哪个文件',
  (await H('git/identity')({ repo: '/tmp/gp34d-ident' })).nameOrigin === '.git/config')
check('别的仓库不受影响（还是全局那份）',
  (await H('git/identity')({ repo: '/tmp/gp34d-ident2' })).name === 'Ada Lovelace')

const before = fs.readFileSync(IDENT_GLOBAL, 'utf8')
check('两个都空 → 什么都不写，并说清为什么',
  (await H('git/identity-save')({ scope: 'global', name: '  ', email: '' })).ok !== true
  && fs.readFileSync(IDENT_GLOBAL, 'utf8') === before)
check('控制字符被拒（一个换行能把命令切成两半）',
  (await H('git/identity-save')({ scope: 'global', name: 'a\nb' })).ok !== true
  && fs.readFileSync(IDENT_GLOBAL, 'utf8') === before)
check('以 - 开头的值被拒（git 会把它当选项）',
  (await H('git/identity-save')({ scope: 'global', name: '-x' })).ok !== true
  && fs.readFileSync(IDENT_GLOBAL, 'utf8') === before)
check('要写本地却不知道是哪个仓库 → 直说，而不是猜一个',
  (await H('git/identity-save')({ scope: 'local', name: 'x' })).ok !== true)

/* 提交本身：写完之后这台机器就签得出名了。 */
const committed = await H('git/commit')({ repo: '/tmp/gp34d-ident', message: 'first', stageAll: true })
const logLine = (await sh("git log -1 --format='%an <%ae>'", '/tmp/gp34d-ident')).out.trim()
console.log('  提交一次:', JSON.stringify({ ok: committed.ok, author: logLine }))
check('配好身份之后提交成功，作者就是刚写进去的那个名字', committed.ok === true && logLine === 'Repo Only <ada@example.com>')
check('而且这次答复里没有身份这个标志', committed.needsIdentity === undefined)

console.log('')
if (guards.length > 0) {
  console.log('✗ ' + guards.length + ' 条不符合预期')
  process.exit(1)
}
console.log('（gp34d 全部通过）')
