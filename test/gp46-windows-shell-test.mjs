/* ── Windows 上，这些 POSIX 脚本真能跑起来吗 ──

   这个插件的每一条命令都是一个 POSIX sh 脚本，而 DSH 的 `shell` 是「抽象 bash 执行服务」：
   Linux/macOS 上由 bash 实现（脚本原样跑），Windows 上默认由 pwsh 实现（同一个字符串就是一个
   解析错误）。这条套件用真的 PowerShell、真的 POSIX shell、真的 git，把 Windows 上可能遇到的
   四种部署各跑一遍，断言落在答复和**交给 shell 的形态**上：

     A. Windows + pwsh（DSH 在 Windows 上的默认装配）：先问一句语言，然后把脚本交给 Git for
        Windows 的 sh.exe —— 脚本走 stdin，PATH 前导在里面。
     B. Windows + bash（同一个 Windows 上换一种装配）：问出来「不是 PowerShell」，脚本原样交给
        它 —— 绝不能把一条 PowerShell 命令喂给 bash。
     C. Windows + pwsh，但 Git 装在默认位置之外：设置页那个「git 位置」写的是绝对路径时，
        sh.exe 要从**同一个安装**里找出来。
     D. Windows + pwsh，而且磁盘上没有 sh.exe：照旧原样交出去（与加这段之前一样），并且
        git/toolchain 说得出是为什么。

   别的平台上它说一句就退出 —— 那条路本来就不需要封装（见 gp47）。 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

let passed = 0
let failed = 0
function check(label, value, extra) {
  if (value) { passed += 1; console.log('  ✓ ' + label) } else { failed += 1; console.log('  ✗ ' + label + (extra === undefined ? '' : '   ← ' + extra)) }
}

const DIALECT_PROBE = '$PSVersionTable.PSVersion.Major'
const ENCODING_PREAMBLE = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); '

/* DSH 自己怎么找 PowerShell：PowerShell 7 安装点 → PATH 里的 pwsh.exe →
   System32 下的 Windows PowerShell 5.1（dsh-pwsh-local 的解析顺序）。 */
const pwshPath = (function () {
  const candidates = [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')]
  for (const entry of String(process.env.PATH || '').split(';')) {
    const trimmed = entry.trim().replace(/^"|"$/g, '')
    if (trimmed.length > 0) candidates.push(path.join(trimmed, 'pwsh.exe'))
  }
  candidates.push(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  for (const candidate of candidates) { if (fs.existsSync(candidate)) return candidate }
  return ''
})()

const shPath = (function () {
  const candidates = [
    path.join(process.env.ProgramFiles || '', 'Git', 'usr', 'bin', 'sh.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'usr', 'bin', 'sh.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'usr', 'bin', 'sh.exe'),
  ]
  for (const candidate of candidates) { if (candidate.length > 0 && fs.existsSync(candidate)) return candidate }
  return ''
})()

if (process.platform !== 'win32' || pwshPath === '' || shPath === '') {
  console.log('  ok  这条套件只在这台机器上跑（Windows + PowerShell + Git for Windows 的 sh.exe）')
  process.exit(0)
}

/* ── 一个真的仓库 ── */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-idea-win-'))
const repo = path.join(root, 'repo')
const homePlain = path.join(root, 'home-plain')
const homeConfigured = path.join(root, 'home-configured')
fs.mkdirSync(repo, { recursive: true })
fs.mkdirSync(homePlain, { recursive: true })
fs.mkdirSync(homeConfigured, { recursive: true })
const git = (args, cwd) => spawnSync('git', args, { cwd: cwd || repo, encoding: 'utf8', windowsHide: true })
git(['init', '-q', '-b', 'main'])
git(['config', 'user.email', 'test@example.com'])
git(['config', 'user.name', 'Test'])
fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n')
git(['add', '-A'])
git(['commit', '-qm', 'first'])
const origin = path.join(root, 'origin.git')
git(['init', '-q', '--bare', origin], root)
git(['remote', 'add', 'origin', origin])
git(['push', '-q', '-u', 'origin', 'main'])

/* C 用的那份配置：git 装在默认位置之外。这里写的就是这台机器上真的那个 git，但 C 会把
   三个默认安装点从环境里拿掉，于是解析只能靠「git 旁边」那一条路。 */
const realGit = path.join(process.env.ProgramFiles || '', 'Git', 'cmd', 'git.exe')
fs.writeFileSync(path.join(homeConfigured, 'dsh-git-idea.json'), JSON.stringify({ gitPath: realGit }) + '\n')

function resolved(request) {
  return {
    command: request.command,
    workdir: request.workdir === undefined ? repo : request.workdir,
    timeoutMs: typeof request.timeoutMs === 'number' ? request.timeoutMs : 120000,
    onExpiry: 'kill',
    stdoutMaxBytes: request.stdoutMaxBytes === undefined ? 1048576 : request.stdoutMaxBytes,
    stdin: request.stdin,
    sandboxPolicy: request.sandboxPolicy,
  }
}

function run(exe, argv, spec, home) {
  const env = Object.assign({}, process.env, { DSH_HOME: home, HOME: home })
  const child = spawnSync(exe, argv, {
    cwd: spec.workdir,
    input: spec.stdin === undefined ? '' : spec.stdin,
    env: env,
    encoding: 'utf8',
    timeout: spec.timeoutMs,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  })
  return {
    exitCode: child.status,
    signal: null,
    timedOut: child.error != null && child.error.code === 'ETIMEDOUT',
    aborted: false,
    timeoutMs: spec.timeoutMs,
    stdout: { text: child.stdout || '', truncated: false },
    stderr: { text: child.stderr || '', truncated: false },
  }
}

/* ── 两种 shell 实现，都按 DSH 真实的样子跑 ──
   pwsh：`pwsh -Command <编码前导 + command>`，stdin 原样递进去 —— dsh-pwsh-local 的 argv 与
        spawnSpec，也就是 DSH 在 Windows 上的默认装配。
   sh  ：一个真的 POSIX shell（Git for Windows 的 sh.exe），也就是「这个 Windows 上装配的是
        bash 那一半」时 DSH 会用的东西。 */
function pwshShell(seen, home) {
  return {
    resolve(request) { return resolved(request) },
    async execute(spec) {
      seen.push({ command: spec.command, stdin: spec.stdin })
      return { result: async () => run(pwshPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ENCODING_PREAMBLE + spec.command], spec, home) }
    },
  }
}

function shShell(seen, home) {
  return {
    resolve(request) { return resolved(request) },
    async execute(spec) {
      seen.push({ command: spec.command, stdin: spec.stdin })
      return { result: async () => run(shPath, ['-c', spec.command], spec, home) }
    },
  }
}

/* 每次 apply 都是一份新的插件闭包（片段里的状态都在 apply 里），所以四种装配可以在同一个
   进程里各跑一遍，互不干扰。 */
async function scenario(shellService) {
  const pkg = await import(new URL('../lib/index.js', import.meta.url))
  const routes = []
  const ctx = {
    webServer: { register(route) { routes.push(route); return () => {} } },
    get(name) { return name === 'shell' ? shellService : undefined },
    effect(callback) { const dispose = callback(); return typeof dispose === 'function' ? dispose : () => {} },
    inject(_deps, callback) { return callback(ctx) },
  }
  await pkg.apply(ctx, {})
  return async function rpc(method, payload) {
    const response = {
      statusCode: 0, body: '',
      writeHead(status) { this.statusCode = status },
      end(text) { this.body = text === undefined ? '' : String(text) },
    }
    const request = {
      method: 'POST',
      headers: { host: '127.0.0.1:19387' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ method: method, payload: payload })) },
    }
    await routes[0].handler(request, response)
    const parsed = JSON.parse(response.body)
    if (response.statusCode !== 200) throw new Error(method + ' answered HTTP ' + response.statusCode + ': ' + response.body)
    return parsed.value
  }
}

const wrapped = (row) => row.command.slice(0, 3) === "& '"
  && typeof row.stdin === 'string'
  && row.stdin.indexOf('PATH="/usr/bin:/mingw64/bin:/cmd:$PATH"') === 0

/* ── A. Windows + pwsh（默认装配） ── */
const seenA = []
const rpcA = await scenario(pwshShell(seenA, homePlain))
const toolA = await rpcA('git/toolchain', {})
const panelA = await rpcA('git/panel', { quick: true, repo: repo })
const probesA = seenA.filter((row) => row.command === DIALECT_PROBE)
const scriptsA = seenA.filter((row) => row.command !== DIALECT_PROBE)

check('A 先问一句这个部署的 shell 是什么语言（不封装）',
  probesA.length === 1, JSON.stringify(seenA.map((row) => row.command.slice(0, 30))))
check('A 找 sh.exe 没有经过 shell（没有任何 Test-Path 探针）',
  seenA.every((row) => row.command.indexOf('Test-Path') < 0 && row.command.indexOf('dsh-git-idea-sh') < 0))
check('A 问出来是 PowerShell 之后，每一条命令都交给 sh.exe（脚本连 PATH 前导走 stdin）',
  scriptsA.length > 0 && scriptsA.every(wrapped), JSON.stringify(scriptsA.length) + ' 条')
check('A git/toolchain 找到了 git', toolA.ok === true && toolA.found === true, JSON.stringify(toolA))
check('A git/panel 读得出分支与上游', panelA.ok === true && panelA.branch === 'main' && panelA.upstream === 'origin/main', JSON.stringify(panelA))
check('A 设置页说得出是哪个 sh.exe 在读命令',
  toolA.shell != null && toolA.shell.kind === 'git-sh' && String(toolA.shell.path).endsWith('sh.exe'), JSON.stringify(toolA.shell))

/* ── B. Windows + bash（同一个 Windows，另一种装配） ── */
const seenB = []
const rpcB = await scenario(shShell(seenB, homePlain))
const toolB = await rpcB('git/toolchain', {})
const panelB = await rpcB('git/panel', { quick: true, repo: repo })

check('B 这个部署的 shell 自己就读得懂 POSIX：脚本原样交给它，一条 PowerShell 命令都没有',
  seenB.length > 0 && seenB.every((row) => !wrapped(row)) && seenB.every((row) => row.stdin === undefined),
  JSON.stringify(seenB.map((row) => row.command.slice(0, 40))))
check('B git/toolchain 照样读得到', toolB.ok === true && toolB.found === true, JSON.stringify(toolB))
check('B git/panel 照样读得出分支', panelB.ok === true && panelB.branch === 'main', JSON.stringify(panelB))
check('B 设置页不说 sh.exe 的事（这个部署不需要它）',
  toolB.shell != null && toolB.shell.kind === 'native', JSON.stringify(toolB.shell))

/* 环境变量是解析 sh.exe 的两条来源（三个默认安装点、PATH 上的 git.exe），逐个场景借走、
   还回来。`withoutPath` 连 PATH 一起拿掉 —— 那就是「这台机器上哪儿都没有 sh.exe」。 */
async function withoutDefaultGit(build, withoutPath) {
  const saved = {}
  const names = ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']
  if (withoutPath) names.push('PATH')
  for (const name of names) {
    saved[name] = process.env[name]
    process.env[name] = withoutPath && name === 'PATH' ? path.join(root, 'empty-path') : undefined
    if (process.env[name] === undefined) delete process.env[name]
  }
  if (withoutPath) {
    fs.mkdirSync(path.join(root, 'empty-path'), { recursive: true })
    process.env.PATH = path.join(root, 'empty-path')
  }
  try {
    return await build()
  } finally {
    for (const name of Object.keys(saved)) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
  }
}

/* ── C. Windows + pwsh，Git 装在默认位置之外（但在 PATH 上） ──
   三个默认安装点拿掉之后，只剩「PATH 上每个 git.exe 的旁边」这一条路。 */
const seenC = []
const toolC = await withoutDefaultGit(async function () {
  const rpcC = await scenario(pwshShell(seenC, homePlain))
  return await rpcC('git/toolchain', {})
})
const expectedC = path.join(path.dirname(path.dirname(realGit)), 'usr', 'bin', 'sh.exe')
check('C 默认安装点全拿掉之后，从 PATH 上 git.exe 旁边的 usr\\bin 里找到了 sh.exe',
  toolC != null && toolC.shell != null && toolC.shell.kind === 'git-sh' && toolC.shell.path === expectedC,
  JSON.stringify(toolC == null ? null : toolC.shell) + '  期望 ' + expectedC)

/* ── D. Windows + pwsh，而且这台机器上哪儿都没有 sh.exe ── */
const seenD = []
const toolD = await withoutDefaultGit(async function () {
  const rpcD = await scenario(pwshShell(seenD, homePlain))
  return await rpcD('git/toolchain', {})
}, true)
const scriptsD = seenD.filter((row) => row.command !== DIALECT_PROBE)
check('D 没有 sh.exe 时照旧原样交出去（与加这段之前一样，不换一种坏法）',
  scriptsD.length > 0 && scriptsD.every((row) => !wrapped(row) && row.stdin === undefined),
  JSON.stringify(scriptsD.map((row) => row.command.slice(0, 40))))
check('D 设置页说得出「没找到 sh.exe」',
  toolD != null && toolD.shell != null && toolD.shell.kind === 'none', JSON.stringify(toolD == null ? null : toolD.shell))

console.log('')
console.log('  passed: ' + passed + '   failed: ' + failed)
process.exit(failed > 0 ? 1 : 0)
