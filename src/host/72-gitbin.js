/* ─────────────── which git this machine runs ───────────────

   Every command this plugin runs starts with one word: `git`. That word comes
   from the deployment's PATH, and on a machine where git lives somewhere the
   deployment's PATH does not look — a Homebrew prefix, a bundled git inside an
   IDE, a nix profile — the plugin's answer used to be "this machine has no git",
   which is both wrong and unactionable. So the word is a setting.

   The resolution is deliberately one function and one variable: `gitExe` is what
   the config says, `gitCmd()` is how it is written into a command line, and the
   config read happens before any handler builds a command (see `onRpc`), so no
   command can be built from a half-loaded answer. */

/* Where the resolved binary is kept. `applyConfig` is the one place that writes
   it, so reading the config and running a command can never disagree. */
let gitExe = 'git'

function applyConfig(config) {
  gitExe = isStr(config.gitPath) && config.gitPath.length > 0 ? config.gitPath : 'git'
  return config
}

/* The command word every shell string is built from — quoted, because a path
   with a space in it is a perfectly good path. */
function gitCmd() {
  return gitExe === 'git' ? 'git' : shq(gitExe)
}

/* A path that is about to be put in front of every git command on this machine.
   It is the reader's own text, so it is not a threat to *them* — but a stray
   newline would cut the panel scripts in half, and a leading `-` would turn the
   command into an option. Both are refused here rather than quoted and hoped
   for; anything else (spaces, quotes) `shq` and `command -v` carry. */
function cleanGitPath(value) {
  const trimmed = value.trim().slice(0, 400)
  if (trimmed.length === 0) return ''
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return ''
  if (trimmed.charAt(0) === '-') return ''
  return trimmed
}

/* ── what the settings page shows ──

   Three answers about the same word: what `command -v` resolves it to (the
   configured path itself, or the one on PATH), whether that thing runs at all,
   and its version. The read does not go through `gitGuard`: a toolchain probe
   that reports "no git" by failing to run is exactly the answer being asked
   for, so it must not be turned into "this is not a repository".

   `P:` is printed even when `command -v` finds nothing (an empty line), because
   "the word is not there" and "the probe did not run" have to stay apart. */
async function toolchainSnapshot() {
  const config = await readConfigFile()
  const probe = await invoke(
    'p=$(command -v ' + gitCmd() + ' 2>/dev/null || true)\n'
    + "printf 'P:%s\\n' \"$p\"\n"
    + "printf 'V:%s\\n' \"$(" + gitCmd() + ' --version 2>&1 | head -1)"\n',
    {}, null, { timeoutMs: 10000 })
  let resolved = ''
  let version = ''
  const lines = probe.stdout.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].indexOf('P:') === 0) resolved = lines[i].slice(2).trim()
    if (lines[i].indexOf('V:') === 0) version = lines[i].slice(2).trim()
  }
  /* A configured path that does not resolve is not the same failure as a machine
     with no git on PATH, and the fix is different — so it says which one it is. */
  const reason = resolved.length > 0
    ? ''
    : (config.gitPath.length > 0 ? 'configured-missing' : 'not-on-path')
  return {
    ok: true,
    configured: config.gitPath,
    fromPath: config.gitPath.length === 0,
    path: resolved,
    version: version,
    found: resolved.length > 0,
    reason: reason,
    platform: probe.exitCode === 0 ? 'ok' : 'probe-failed',
  }
}
