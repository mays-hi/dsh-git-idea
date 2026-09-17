/* ─────────────── primitives ─────────────── */

function shq(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
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

function here(args, exec) {
  const cwd = workdirFor(args, exec)
  return cwd === undefined ? null : cwd
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
  const raw = await shell.run(shell.resolve(request))
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
const GIT_GUARD = 'command -v git >/dev/null 2>&1 || { printf ' + shq(GIT_MISSING_MARK + '\n') + ' >&2; exit 127; }\n'
const PANEL_NO_GIT = 'N:nogit'

/* The three wrappers differ only in what they put in front of the command: the
   package prefix is the whole of the difference, so it is the only argument. */
async function shellGit(prefix, args, argv, exec, options) {
  const result = await invoke(GIT_GUARD + prefix + 'git ' + argv.map(shq).join(' '), args, exec, options)
  result.command = 'git ' + argv.join(' ')
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
   `GIT_GUARD`. One flag, read in one place per surface: the mutating commands
   through `commandDetail`, the panel reads through their `reason`. */
function gitMissing(result) {
  return result != null && result.noGit === true
}

