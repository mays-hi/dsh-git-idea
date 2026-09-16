/* ─────────────── primitives ─────────────── */

function shq(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

function isStr(value) {
  return typeof value === 'string'
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

async function git(args, argv, exec, options) {
  const result = await invoke('git ' + argv.map(shq).join(' '), args, exec, options)
  result.command = 'git ' + argv.join(' ')
  result.ok = result.exitCode === 0
  return result
}

/* Network commands must never sit waiting for a credential prompt: the panel has
   no terminal to answer one, so the call would hang until its timeout fires. */
async function gitNet(args, argv, exec, options) {
  const result = await invoke('GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true git ' + argv.map(shq).join(' '), args, exec, options)
  result.command = 'git ' + argv.join(' ')
  result.ok = result.exitCode === 0
  return result
}

/* for-each-ref's %(upstream:track) is the one atom git translates. The switcher
   shows the numbers out of it, so the words around them have to be predictable
   rather than whatever locale the machine happens to use. */
async function gitC(args, argv, exec, options) {
  const result = await invoke('LC_ALL=C git ' + argv.map(shq).join(' '), args, exec, options)
  result.command = 'git ' + argv.join(' ')
  result.ok = result.exitCode === 0
  return result
}

