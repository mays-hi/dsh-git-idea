/* ── 非 Windows 上，插件还是走它原来那条路吗 ──

   src/host/10-shell.js 在 win32 上把 POSIX 脚本交给 Git for Windows 的 sh.exe；别的
   平台上那段必须一个字节都不生效 —— Linux/macOS 的 `shell` 本来就是 bash，脚本直接
   交给它读。这条套件把 process.platform 当成 POSIX、用一个真的 POSIX shell 当 `shell`，
   然后断言两件事：

     (1) 插件交给 shell 的就是它原本那段脚本：没有被包成 `& '…sh.exe'`，也没有被挪到
         stdin 去，更不会先跑那个找 sh.exe 的探针；
     (2) 这样跑下来它照样读得出真的仓库。

   在 Windows 上它借 Git for Windows 的 sh.exe 当那个 POSIX shell；在 Linux/macOS 上
   直接用 /bin/sh —— 那就是它本来跑的那条路。 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

let passed = 0
let failed = 0
function check(label, value, extra) {
  if (value) { passed += 1; console.log('  ✓ ' + label) } else { failed += 1; console.log('  ✗ ' + label + (extra === undefined ? '' : '   ← ' + extra)) }
}

const REAL_PLATFORM = process.platform
const IS_WINDOWS = REAL_PLATFORM === 'win32'

function gitSh() {
  const candidates = [
    path.join(process.env.ProgramFiles || '', 'Git', 'usr', 'bin', 'sh.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'usr', 'bin', 'sh.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'usr', 'bin', 'sh.exe'),
  ]
  for (const candidate of candidates) { if (candidate.length > 0 && fs.existsSync(candidate)) return candidate }
  return ''
}

const POSIX_SHELL = IS_WINDOWS ? gitSh() : '/bin/sh'
if (POSIX_SHELL === '' || !fs.existsSync(POSIX_SHELL)) {
  console.log('  ok  这台机器上找不到 POSIX shell，跳过')
  process.exit(0)
}

/* A real repository, so "it still reads" is not a claim about mocks. */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-idea-posix-'))
const repo = path.join(root, 'repo')
const home = path.join(root, 'home')
fs.mkdirSync(repo, { recursive: true })
fs.mkdirSync(home, { recursive: true })
const git = (args, cwd) => spawnSync('git', args, { cwd: cwd || repo, encoding: 'utf8', windowsHide: true })
git(['init', '-q', '-b', 'main'])
git(['config', 'user.email', 'test@example.com'])
git(['config', 'user.name', 'Test'])
fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n')
git(['add', '-A'])
git(['commit', '-qm', 'first'])

/* Every spec the plugin hands to the shell, kept so the assertions can look at
   what was passed rather than at what came back. */
const seen = []

function runPosix(spec) {
  seen.push({ command: spec.command, stdin: spec.stdin })
  const env = Object.assign({}, process.env, { DSH_HOME: home, HOME: home })
  if (IS_WINDOWS) {
    /* 借来的这个 POSIX shell 得有一条像 Linux 那样的 PATH：真机上 `head`、`stat`、
       `git` 都在 /usr/bin。这里补的是**环境**，不是命令 —— 命令本身必须还是原样。 */
    const usrBin = path.dirname(POSIX_SHELL)
    const gitRoot = path.dirname(path.dirname(usrBin))
    env.PATH = [usrBin, path.join(gitRoot, 'mingw64', 'bin'), path.join(gitRoot, 'cmd'), env.PATH || ''].join(path.delimiter)
  }
  const child = spawnSync(POSIX_SHELL, ['-c', spec.command], {
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

const shell = {
  resolve(request) {
    return {
      command: request.command,
      workdir: request.workdir === undefined ? repo : request.workdir,
      timeoutMs: typeof request.timeoutMs === 'number' ? request.timeoutMs : 120000,
      onExpiry: 'kill',
      stdoutMaxBytes: request.stdoutMaxBytes === undefined ? 1048576 : request.stdoutMaxBytes,
      stdin: request.stdin,
      sandboxPolicy: request.sandboxPolicy,
    }
  },
  async execute(spec) {
    const result = runPosix(spec)
    return { result: () => Promise.resolve(result) }
  },
}

/* 站到 POSIX 那条分支上。真机上本来就是，只有 Windows 需要假装。 */
if (IS_WINDOWS) {
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' })
  } catch (error) {
    console.log('  ok  改不动 process.platform，跳过')
    process.exit(0)
  }
  if (process.platform !== 'linux') { console.log('  ok  改不动 process.platform，跳过'); process.exit(0) }
}

const pkg = await import(new URL('../lib/index.js', import.meta.url))

const routes = []
const ctx = {
  webServer: { register(route) { routes.push(route); return () => {} } },
  get(name) { return name === 'shell' ? shell : undefined },
  effect(callback) { const dispose = callback(); return typeof dispose === 'function' ? dispose : () => {} },
  inject(_deps, callback) { return callback(ctx) },
}

function rpcRequest(body) {
  const payload = Buffer.from(JSON.stringify(body))
  return {
    method: 'POST',
    headers: { host: '127.0.0.1:19387' },
    async *[Symbol.asyncIterator]() { yield payload },
  }
}

async function rpc(method, payload) {
  if (routes.length === 0) await pkg.apply(ctx, {})
  const response = {
    statusCode: 0, body: '',
    writeHead(status) { this.statusCode = status },
    end(text) { this.body = text === undefined ? '' : String(text) },
  }
  await routes[0].handler(rpcRequest({ method, payload }), response)
  const parsed = JSON.parse(response.body)
  if (response.statusCode !== 200) throw new Error(method + ' answered HTTP ' + response.statusCode + ': ' + response.body)
  return parsed.value
}

const toolchain = await rpc('git/toolchain', {})
const identity = await rpc('git/panel', { quick: true, repo: repo })

check('POSIX 分支上，脚本原样交给了 shell（没有 `& sh.exe` 那层封装）',
  seen.length > 0 && seen.every((row) => row.command.indexOf('dsh-git-idea-sh:') < 0 && row.command.slice(0, 2) !== '& '),
  JSON.stringify(seen.map((row) => row.command.slice(0, 40))))
check('POSIX 分支上，没有任何东西被挪到 stdin（脚本自己也没有）',
  seen.every((row) => row.stdin === undefined),
  JSON.stringify(seen.map((row) => row.stdin === undefined)))
check('POSIX 分支上，插件自己的 POSIX 判据原封不动地到了 shell',
  seen.some((row) => row.command.indexOf('command -v') >= 0),
  JSON.stringify(seen.map((row) => row.command.slice(0, 30))))
check('这样跑下来照样找得到 git', toolchain.ok === true && toolchain.found === true, JSON.stringify(toolchain))
check('这样跑下来照样读得出仓库和分支', identity.ok === true && identity.branch === 'main', JSON.stringify(identity))

if (IS_WINDOWS) Object.defineProperty(process, 'platform', { value: REAL_PLATFORM })
console.log('')
console.log('  passed: ' + passed + '   failed: ' + failed)
process.exit(failed > 0 ? 1 : 0)
