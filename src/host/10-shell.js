/* ─────────────── primitives ─────────────── */

function shq(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}
/* PowerShell 的单引号字面量：只有一个字符要转义，写法是把它写成两个。插件的命令
   行走的是 DSH 的 shell 通道，而在 Windows 上那条通道的那一头是 PowerShell，所以
   只有「把 sh.exe 这个绝对路径交给它」这一处需要它的引号。 */
function pshq(value) {
  return "'" + String(value).replace(/'/g, "''") + "'"
}

function isStr(value) {
  return typeof value === 'string'
}

/* One field of a record git printed as a separated line. A field git had nothing
   to put in is simply absent from the split, and every reader wants the same
   thing there: the empty string, never `undefined` leaking into a reply the
   Client will render. Longhand this is `fields[3] === undefined ? '' : fields[3]`
   — a forty-two times repeated question, asked once here. */
function field(split, index) {
  const value = split[index]
  return value === undefined ? '' : value
}

function sessionCwd(exec) {
  if (exec == null || exec.agent == null) return undefined
  const session = exec.agent.session
  const header = session != null ? session.header : undefined
  const cwd = header != null ? header.cwd : undefined
  return isStr(cwd) && cwd.length > 0 ? cwd : undefined
}

function workdirFor(args, exec) {
  if (args != null && isStr(args.repo) && args.repo.trim().length > 0) return args.repo.trim()
  return sessionCwd(exec)
}

/* ── whose sandbox these commands run under ──

   A shell call that names no policy gets the *deployment* default, not the
   session's. Measured on this deployment: the default is `workspace-write` rooted
   at the deployment's own directory (/mnt/c/Users/mayou here) while the session is
   `danger-full-access` — so every writing git command failed with "Permission
   denied" on `.git/index.lock` for any repository outside that one directory,
   while reads were fine and it looked like git refusing to work.

   The session's mode and its cwd are exactly what the reader's own commands run
   under, so they are what this plugin asks for: `sessions` says which session,
   `sandboxPolicy` says what that session resolved to, and a session that is
   read-only keeps this plugin read-only. Without either service the request goes
   out unchanged and the shell layer falls back as before. */
function sandboxFor(args, exec) {
  const policy = ctx.get('sandboxPolicy')
  if (policy === undefined) return undefined
  let session = null
  try {
    if (exec != null && exec.agent != null && exec.agent.session != null) {
      session = exec.agent.session
    } else if (args != null && isStr(args.sessionId) && args.sessionId.length > 0) {
      const sessions = ctx.get('sessions')
      if (sessions !== undefined) session = sessions.get(args.sessionId)
    }
    if (session == null) return undefined
    const resolved = policy.resolve({ session: session })
    return resolved == null ? undefined : resolved
  } catch (error) {
    console.error('dsh-git-idea: could not resolve this session\'s sandbox policy', String(error))
    return undefined
  }
}

/* ── one executor, two shapes ──

   DSH 0.1.7 replaced the executor's one-shot `run(spec)` with `execute(spec)`:
   the call now resolves with a live handle, and `result()` on that handle is the
   settled run this file has always read. Both shapes are served here so one body
   runs on 0.1.5/0.1.6 and on 0.1.7+ — `execute` is preferred exactly when the
   executor offers it, and nothing else about the request changes. */
async function rawRun(spec) {
  if (typeof shell.execute === 'function') {
    const execution = await shell.execute(spec)
    return typeof execution.result === 'function' ? await execution.result() : execution
  }
  return await shell.run(spec)
}

/* ── Windows 上，脚本由谁来读 ──

   这个插件的每一条命令都是一个 POSIX sh 脚本：`[ -d ... ]`、`printf`、`$(...)`、
   `command -v`、`case`。DSH 的 shell 抽象在 Linux/macOS 上由 bash 实现，在 Windows
   上由 pwsh 实现 —— 同一个字符串交给 PowerShell 就是一个解析错误（真机上量到的原话：
   标记"||"不是此版本中的有效语句分隔符），每一次读都以退出码 1 和一段 ParserError
   结束：`git/toolchain` 的 `platform` 是 `probe-failed`，`git/panel` 说
   `reason: missing`（「这个目录不存在」），面板一行都读不出来 —— 点开是空的，
   而且不是仓库的问题。

   所以 Windows 上把脚本交给一个真的 POSIX shell 读：Git for Windows 自带
   `usr/bin/sh.exe`。脚本走 stdin（`sh` 不带参数就从 stdin 读），命令行走的还是同一条
   shell 通道 —— 工作目录、超时、输出上限、沙箱策略一样都不少。脚本开头自己把 MSYS
   的 `/usr/bin`、`/mingw64/bin`、`/cmd` 放进 PATH：`head`、`stat` 和 `git` 都在那里，
   而宿主进程继承来的 PATH 不一定包含它们（量过：PATH 只剩 system32 时
   `command -v git` 是空的，前导加上这三条之后 git/head/stat 全都解析得到）。

   只在 win32 上生效：别的平台上 `shell` 本来就是 bash，行为一个字节都不变。找不到
   `sh.exe` 时照旧把脚本原样交出去 —— 那台机器上的表现和今天一样，不会更坏。 */
/* 这三个是 Git for Windows 自己的默认安装点。故意不查 PATH：Windows 上 PATH 里那个
   `bash` 是 WSL 的（`C:\Windows\system32\bash.exe`），它看不到 `D:\` 这样的路径，
   拿它去读这些脚本只是把一种失败换成另一种。 */
const WIN_SH_TAIL = '\\Git\\usr\\bin\\sh.exe'

/* 一个路径的上一级、再上一级：`<root>\cmd\git.exe` 与 `<root>\mingw64\bin\git.exe`
   都回到 `<root>`，而 `<root>\usr\bin\sh.exe` 就是同一个安装里的 POSIX shell。 */
function parentOf(value) {
  const cut = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'))
  return cut > 0 ? value.slice(0, cut) : ''
}

function winShOnDisk() {
  if (typeof fs === 'undefined') return ''
  const tried = {}
  const exists = function (candidate) {
    if (candidate.length === 0 || tried[candidate] === true) return false
    tried[candidate] = true
    try { return fs.existsSync(candidate) } catch (error) { return false }
  }
  /* 1. Git for Windows 自己的三个默认安装点。 */
  const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
  for (let i = 0; i < bases.length; i += 1) {
    if (isStr(bases[i]) && bases[i].length > 0 && exists(bases[i] + WIN_SH_TAIL)) return bases[i] + WIN_SH_TAIL
  }
  if (isStr(process.env.LOCALAPPDATA) && process.env.LOCALAPPDATA.length > 0) {
    const local = process.env.LOCALAPPDATA + '\\Programs' + WIN_SH_TAIL
    if (exists(local)) return local
  }
  /* 2. 这台机器 PATH 上每一个 git.exe 的旁边。装在默认位置之外的 Git（Scoop、
     Chocolatey、IDE 自带的那个、自定义目录）只要在 PATH 上，这里就找得到它 ——
     而它必须在 PATH 上，否则这个插件本来也无从运行 `git`。往上找三层是因为
     `<root>\cmd\git.exe` 与 `<root>\mingw64\bin\git.exe` 深度不同，而 sh.exe
     永远在同一个 `<root>\usr\bin` 下。 */
  const entries = isStr(process.env.PATH) ? process.env.PATH.split(';') : []
  for (let i = 0; i < entries.length; i += 1) {
    const dir = entries[i].trim().replace(/^"|"$/g, '')
    if (dir.length === 0 || !exists(dir + '\\git.exe')) continue
    let root = dir + '\\git.exe'
    for (let depth = 0; depth < 3; depth += 1) {
      root = parentOf(root)
      if (root.length === 0) break
      const beside = root + WIN_SH_TAIL
      if (exists(beside)) return beside
    }
  }
  return ''
}

/* 脚本的第一行：在 MSYS 下这三个目录就是 Git 自己的 usr/bin、mingw64/bin 和 cmd。 */
const POSIX_PATH_PRELUDE = 'PATH="/usr/bin:/mingw64/bin:/cmd:$PATH"\nexport PATH\n'

let winSh
function windowsPosixShell() {
  if (process.platform !== 'win32') return ''
  /* 只记住成功：失败是「磁盘上现在没有」，而它随时可以被装上（装完下一次命令就该认出来），
     不该被一次启动时的结论钉死。重算一次是几十次 existsSync，相对于一次进程启动可以忽略。 */
  if (winSh === undefined || winSh === '') winSh = winShOnDisk()
  return winSh
}

/* ── 这个部署的 shell 读得懂 POSIX 吗 ──

   Windows 上 DSH 的 shell 默认由 pwsh 实现，插件的 POSIX 脚本得另找一个 shell 来读；但那是
   **这个部署的选择**，不是平台的：同一个 Windows 上也可以装配 bash 那个实现（`shell` 是
   「抽象 bash 执行服务」，pwsh 只是它的一种实现），而把一条 PowerShell 命令喂给 bash 是另一种
   坏法。所以先问一句它是什么语言。

   问不出来（不是答错，是根本没跑成）时不写结论：这一次按平台默认（Windows 上默认是 pwsh）
   走，下一次再问。只有真的答了「不是 PowerShell」才记住 —— 那个答案是稳定的，而这个错误不是。 */
const SHELL_DIALECT_PROBE = '$PSVersionTable.PSVersion.Major'

let shellReadsPosix
async function shellSpeaksPosix() {
  if (process.platform !== 'win32') return true
  if (shellReadsPosix !== undefined) return shellReadsPosix
  try {
    const raw = await rawRun(shell.resolve({ command: SHELL_DIALECT_PROBE, timeoutMs: 15000, stdoutMaxBytes: 4096 }))
    const out = raw != null && raw.stdout != null && isStr(raw.stdout.text) ? raw.stdout.text.replace(/^\s+/, '') : ''
    shellReadsPosix = !/^[0-9]/.test(out)
  } catch (error) {
    return false
  }
  return shellReadsPosix
}

/* 设置页要说得清「这些命令是谁在读」：Linux/macOS 上就是 shell 自己（bash），Windows 上是
   这个部署自己的 shell（装配的是 bash 时也一样），或者 Git 的 sh.exe。找不到 sh.exe 时面板
   读不出来，而这一行是唯一能说清为什么的地方 —— 它跟着 git/toolchain 一起回给设置页。 */
function posixShellSnapshot() {
  if (process.platform !== 'win32') return { platform: process.platform, kind: 'native', path: '' }
  if (shellReadsPosix === true) return { platform: 'win32', kind: 'native', path: '' }
  const found = windowsPosixShell()
  return { platform: 'win32', kind: found.length > 0 ? 'git-sh' : 'none', path: found }
}

async function runShell(spec) {
  /* 这个部署的 shell 自己就读得懂 POSIX：脚本原样交给它，和别的平台一样。 */
  if (await shellSpeaksPosix()) return await rawRun(spec)
  const sh = windowsPosixShell()
  /* 调用方自己的 stdin 和脚本不能共用同一个流。这个插件今天没有一处传 stdin
     （git 的输入都是实参），所以脚本占着 stdin；真有一天有调用方自带 stdin，
     那一次就按原样交出去，而不是把它吞掉。 */
  if (sh === '' || spec.stdin !== undefined) return await rawRun(spec)
  return await rawRun(Object.assign({}, spec, {
    command: '& ' + pshq(sh),
    stdin: POSIX_PATH_PRELUDE + spec.command,
  }))
}

async function invoke(command, args, exec, options) {
  const opts = options == null ? {} : options
  const request = {
    command: command,
    timeoutMs: typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : 120000,
    stdoutMaxBytes: typeof opts.maxBytes === 'number' ? opts.maxBytes : 1048576,
  }
  const workdir = workdirFor(args, exec)
  if (workdir !== undefined) request.workdir = workdir
  if (isStr(opts.stdin)) request.stdin = opts.stdin
  const sandbox = sandboxFor(args, exec)
  if (sandbox !== undefined) request.sandboxPolicy = sandbox
  const raw = await runShell(shell.resolve(request))
  const out = raw.stdout == null ? null : raw.stdout
  const err = raw.stderr == null ? null : raw.stderr
  return {
    exitCode: raw.exitCode == null ? null : raw.exitCode,
    stdout: out !== null && isStr(out.text) ? out.text : '',
    stderr: err !== null && isStr(err.text) ? err.text : '',
    truncated: (out !== null && out.truncated === true) || (err !== null && err.truncated === true),
    spillPath: out !== null && isStr(out.spillPath) ? out.spillPath : null,
    timedOut: raw.timedOut === true,
    aborted: raw.aborted === true,
    sandboxDenied: raw.sandbox != null && raw.sandbox.denied === true,
    cwd: workdir === undefined ? null : workdir,
  }
}

/* ── the one failure that is not about the repository ──

   On a machine with no `git` on PATH every command below dies at the shell, and
   its "command not found" arrives looking exactly like a repository git refused
   to read: `git status` and `git rev-parse` both answer nothing, `$gd` comes out
   empty, and a perfectly good repository is reported as "not a git repository" —
   the one diagnosis the reader cannot act on, with the path field hidden besides.

   So each git command opens with a question about the machine instead. `command
   -v` is a shell builtin, so the check costs no process, and it asks about the
   PATH *this* command will be resolved with — after `LC_ALL=C` and
   `GIT_TERMINAL_PROMPT=0` have been put in front of it, neither of which changes
   which git is found. The marker word and exit code 127 are what the Host reads;
   bash's own sentence is never matched, because it is printed in whatever
   language the machine happens to speak.

   The panel scripts below are the one place this is not enough: they multiplex
   several answers over stdout in a single process (`pathShell`), so they carry
   the same check's answer as an output marker instead of an exit code —
   `PANEL_NO_GIT`. Same question, same builtin, two transports. */
const GIT_MISSING_MARK = 'dsh-git-idea: no git on PATH'
/* `command -v <word>` answers for a bare name through PATH and for an absolute
   path by checking it is executable, so one guard covers both "the git on PATH"
   and "the git this reader configured". The command word is resolved once per
   call (see `gitCmd` in 70-config.js) and cannot contain a newline. */
function gitGuard() {
  return 'command -v ' + gitCmd() + ' >/dev/null 2>&1 || { printf ' + shq(GIT_MISSING_MARK + '\n') + ' >&2; exit 127; }\n'
}
const PANEL_NO_GIT = 'N:nogit'

/* ── the second failure that is not about the repository ──

   `git commit` refuses to author a commit when it cannot work out who the
   author is, and nothing about that is the repository's fault: the identity
   lives in git's own configuration, and only the reader can choose a name and
   an address. Read as plain stderr it arrives as eight lines of English
   ending in `fatal: empty ident name`, which says what failed and not one word
   about the two commands that fix it.

   Recognised where it happens rather than matched out of that text: git
   translates it, and it has several spellings (identity absent, an address but
   no name, a guessed address that is not a full domain). The question asked
   instead is `git var GIT_AUTHOR_IDENT` — the same lookup `git commit` makes
   before it writes anything — and a non-zero exit answers "this commit is
   going to be refused" in every locale. It is asked only *after* a commit has
   already failed, so the path that works pays nothing for it. */
async function identityMissing(args) {
  const asked = await gitC(args, ['var', 'GIT_AUTHOR_IDENT'], null, {})
  return asked.exitCode !== 0
}

/* The same answer as a marker inside a panel script, where a non-zero exit code
   cannot be the transport: `$gd` is already known to be non-empty by the time
   this runs, so it is one git process, in the whole-tree read only. */
const PANEL_NO_IDENT = 'I:none'

/* The three wrappers differ only in what they put in front of the command: the
   package prefix is the whole of the difference, so it is the only argument. */
async function shellGit(prefix, args, argv, exec, options) {
  const result = await invoke(gitGuard() + prefix + gitCmd() + ' ' + argv.map(shq).join(' '), args, exec, options)
  result.command = gitExe + ' ' + argv.join(' ')
  result.ok = result.exitCode === 0
  result.noGit = result.exitCode === 127 && result.stderr.indexOf(GIT_MISSING_MARK) >= 0
  return result
}

async function git(args, argv, exec, options) {
  return await shellGit('', args, argv, exec, options)
}

/* Network commands must never sit waiting for a credential prompt: the panel has
   no terminal to answer one, so the call would hang until its timeout fires. */
async function gitNet(args, argv, exec, options) {
  return await shellGit('GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true ', args, argv, exec, options)
}

/* for-each-ref's %(upstream:track) is the one atom git translates. The switcher
   shows the numbers out of it, so the words around them have to be predictable
   rather than whatever locale the machine happens to use. */
async function gitC(args, argv, exec, options) {
  return await shellGit('LC_ALL=C ', args, argv, exec, options)
}

/* Every reply that carries a command's failure carries this with it, so that no
   surface has to recognise a missing git by the words in stderr — see
   `gitGuard`. One flag, read in one place per surface: the mutating commands
   through `commandDetail`, the panel reads through their `reason`. */
function gitMissing(result) {
  return result != null && result.noGit === true
}

/* ── HEAD 指着一个还没有提交的分支 ──

   刚 `git init` 出来的仓库就是这样（包括这个插件自己的引导页建出来的那个）：HEAD
   里写着 `refs/heads/main`，而 `refs/heads` 是空的。它没有任何毛病，但所有读 *ref*
   的东西都拿不到答案 —— `for-each-ref` 一个分支都不列，`git log <branch>` 报
   "unknown revision"，而把「这次读失败了」当成「这不是一个仓库」的面板，就会对着
   它自己刚建出来的仓库说那句话。

   这里还剩一个问得出来的问题，而且 git 不用碰任何 ref 就能回答：HEAD 写的是哪个
   分支。只在 ref 表里一个当前分支都没有时才问一次 —— 普通仓库（`%(HEAD)` 已经标出
   来了）一次都不多花。真正的游离 HEAD 同样答不出来，而那正是调用方本来就会处理的
   情况。 */
async function headBranchWithoutCommit(args) {
  const asked = await gitC(args, ['symbolic-ref', '--quiet', '--short', 'HEAD'], null, {})
  if (asked.exitCode !== 0) return ''
  const name = asked.stdout.trim()
  return name.length > 0 ? name : ''
}

