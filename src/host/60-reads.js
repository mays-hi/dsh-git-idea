/* ─────────────── Client RPC ─────────────── */

function repoFrom(input, exec) {
  if (input != null && isStr(input.repo) && input.repo.trim().length > 0) return input.repo.trim()
  const direct = sessionCwd(exec)
  if (direct !== undefined) return direct
  if (input != null && isStr(input.sessionId)) {
    const sessions = ctx.get('sessions')
    if (sessions !== undefined) {
      try {
        const session = sessions.get(input.sessionId)
        const header = session != null ? session.header : undefined
        const cwd = header != null ? header.cwd : undefined
        if (isStr(cwd) && cwd.length > 0) return cwd
      } catch (error) {
        console.error('dsh-git-idea: could not resolve the session cwd', String(error))
      }
    }
  }
  return undefined
}

function argsFor(input) {
  const repo = repoFrom(input, null)
  return repo === undefined ? {} : { repo: repo }
}

/* ─────────────── per-repository read cache ───────────────

   Opening the panel used to cost nine child processes and nothing was reused,
   so every open re-read the whole repository. Reads are now memoised per
   repository and dropped on any mutation.

   Reads no longer age out on a timer. Data may be as old as the last explicit
   invalidation, which is what makes reopening the panel instant; freshness is
   the watcher's job (git/watch below) plus the mutation and refresh paths.

   Time is feature-detected rather than assumed. If the restricted host realm
   has no Date, caching turns itself off completely instead of never expiring. */

const nowMs = (function () {
  if (typeof Date === 'undefined' || typeof Date.now !== 'function') return null
  return function () { return Date.now() }
})()

const readCache = new Map()

async function cached(repo, tag, ttlMs, loader) {
  if (nowMs === null) return await loader()
  const key = repo + '\u0000' + tag
  const hit = readCache.get(key)
  const at = nowMs()
  if (hit !== undefined && (ttlMs <= 0 || at - hit.at < ttlMs)) return hit.value
  const value = await loader()
  if (readCache.size > 300) readCache.clear()
  readCache.set(key, { at: at, value: value })
  return value
}

function invalidateRepo(repo) {
  if (repo === undefined || repo === null) { readCache.clear(); return }
  const prefix = repo + '\u0000'
  const doomed = []
  readCache.forEach(function (_value, key) {
    if (key.indexOf(prefix) === 0) doomed.push(key)
  })
  for (let i = 0; i < doomed.length; i += 1) readCache.delete(doomed[i])
}

const TTL_FOREVER = 0

/* Diagnostics for the "this path is not a repository" setup page. A probe must
   never run with the inspected path as its workdir: when that directory does
   not exist the spawn itself fails before git is ever reached, and the caller
   would see a rejected promise instead of a diagnosis. */
function baseWorkdir(input) {
  const direct = sessionCwd(null)
  if (direct !== undefined) return direct
  if (input != null && isStr(input.sessionId)) {
    const sessions = ctx.get('sessions')
    if (sessions !== undefined) {
      try {
        const session = sessions.get(input.sessionId)
        const header = session != null ? session.header : undefined
        const cwd = header != null ? header.cwd : undefined
        if (isStr(cwd) && cwd.length > 0) return cwd
      } catch (error) {
        console.error('dsh-git-idea: could not resolve a safe workdir', String(error))
      }
    }
  }
  return undefined
}

async function probeShell(input, command) {
  const workdir = baseWorkdir(input)
  const args = workdir === undefined ? {} : { repo: workdir }
  return await invoke(command, args, null, { timeoutMs: 20000 })
}

async function pathKind(input, target) {
  const probe = await probeShell(input, 'if [ -d ' + shq(target) + ' ]; then echo dir; elif [ -f ' + shq(target) + ' ]; then echo file; else echo none; fi')
  const kind = probe.stdout.trim()
  return kind === 'dir' || kind === 'file' ? kind : 'none'
}

/* One shell process answers everything the setup page needs: whether the path
   exists, what it is, git's own status with its exit code carried out
   explicitly, whether an operation is caught half-done, and whether the
   directory is empty. The previous shape cost two or three spawns for the same
   information. */
/* ── the cheap half of a panel read ──

   `git status` stats every tracked file. On a Windows-mounted worktree of a few
   thousand files that is the whole cost of opening the panel: measured on one
   here, 7.0s for the status against 0.13s for the four commands below. Nothing
   in the composer chip, and nothing in the panel's frame, needs the working
   tree — they need to know whether this path is a repository, which branch it is
   on, where that branch stands against its upstream, and whether a cherry-pick,
   merge or rebase is half-done. The working tree is asked for separately, by the
   request that actually shows it. */
function panelIdentityCommand(target) {
  const quoted = shq(target)
  return [
    'if [ -d ' + quoted + ' ]; then',
    "  printf 'K:dir\\n'",
    "  gd=$(git -C " + quoted + " rev-parse --absolute-git-dir 2>/dev/null)",
    '  if [ -z "$gd" ]; then',
    "    if [ -z \"$(ls -A " + quoted + " 2>/dev/null | head -n 1)\" ]; then printf 'E:1\\n'; else printf 'E:0\\n'; fi",
    "    printf 'RC:1\\n'",
    "    printf 'fatal: not a git repository\\n'",
    '  else',
    "    b=$(git -C " + quoted + " symbolic-ref --quiet --short HEAD 2>/dev/null)",
    '    if [ -n "$b" ]; then',
    "      printf 'B:%s\\n' \"$b\"",
    "      printf 'U:%s\\n' \"$(git -C " + quoted + " for-each-ref --format='%(upstream:short)' \"refs/heads/$b\" 2>/dev/null)\"",
    "      printf 'T:%s\\n' \"$(git -C " + quoted + " for-each-ref --format='%(upstream:track)' \"refs/heads/$b\" 2>/dev/null)\"",
    '    fi',
    "    [ -e \"$gd/CHERRY_PICK_HEAD\" ] && printf 'S:cherry-pick\\n'",
    "    [ -e \"$gd/REVERT_HEAD\" ] && printf 'S:revert\\n'",
    "    [ -e \"$gd/MERGE_HEAD\" ] && printf 'S:merge\\n'",
    "    [ -d \"$gd/rebase-merge\" ] && printf 'S:rebase\\n'",
    "    [ -d \"$gd/rebase-apply\" ] && printf 'S:rebase\\n'",
    "    printf 'RC:0\\n'",
    '  fi',
    'elif [ -f ' + quoted + ' ]; then',
    "  printf 'K:file\\n'",
    'else',
    "  printf 'K:none\\n'",
    'fi',
  ].join('\n')
}

function panelCommand(target) {
  const quoted = shq(target)
  return [
    'if [ -d ' + quoted + ' ]; then',
    "  printf 'K:dir\\n'",
    "  out=$(git -C " + quoted + " -c core.quotePath=false status --porcelain=v2 --branch --untracked-files=normal 2>&1); rc=$?",
    "  printf '%s\\n' \"$out\"",
    "  printf 'RC:%s\\n' \"$rc\"",
    '  case "$out" in',
    "    *'not a git repository'*)",
    "      if [ -z \"$(ls -A " + quoted + " 2>/dev/null | head -n 1)\" ]; then printf 'E:1\\n'; else printf 'E:0\\n'; fi ;; ",
    '  esac',
    '  gd=$(git -C ' + quoted + ' rev-parse --absolute-git-dir 2>/dev/null)',
    '  if [ -n "$gd" ]; then',
    "    [ -e \"$gd/CHERRY_PICK_HEAD\" ] && printf 'S:cherry-pick\\n'",
    "    [ -e \"$gd/REVERT_HEAD\" ] && printf 'S:revert\\n'",
    "    [ -e \"$gd/MERGE_HEAD\" ] && printf 'S:merge\\n'",
    "    [ -d \"$gd/rebase-merge\" ] && printf 'S:rebase\\n'",
    "    [ -d \"$gd/rebase-apply\" ] && printf 'S:rebase\\n'",
    '  fi',
    'elif [ -f ' + quoted + ' ]; then',
    "  printf 'K:file\\n'",
    'else',
    "  printf 'K:none\\n'",
    'fi',
  ].join('\n')
}

/* One lightweight spawn answers "did anything change?" for the client watcher.
   It deliberately uses --untracked-files=normal: the per-file walk of `all` is
   the expensive part on a large tree, and a collapsed untracked directory still
   changes the signature when its contents do. The ref table and the HEAD file
   cover what the status walk cannot see: a new commit with no worktree change,
   and — the one the working tree is silent about — a branch switch, whether it
   was made here or in a terminal next to us.

   --no-optional-locks is load-bearing, not decoration: a plain `git status`
   refreshes the index cache and takes .git/index.lock to do it, so a background
   poller racing the user's own `git add` makes THEIR command fail. Measured on
   this machine: 3 of 20 adds failed without the flag, 0 of 30 with it, and the
   reported status is identical either way. */
/* What "did anything move?" costs. The status is the expensive part — seconds
   on a slow mount, every tick — and it is only worth paying while something is
   showing the working tree, which is what `deep` asks for. Everything else in
   the signature is three stats, one for-each-ref and one small file read. */
function watchCommand(target, deep) {
  const quoted = shq(target)
  const out = [
    "st() { stat -c '%Y:%s' \"$1\" 2>/dev/null || stat -f '%m:%z' \"$1\" 2>/dev/null; }",
    "gd=$(git -C " + quoted + " rev-parse --absolute-git-dir 2>/dev/null)",
  ]
  if (deep === true) {
    out.push("git -C " + quoted + " --no-optional-locks -c core.quotePath=false status --porcelain=v2 --branch --untracked-files=normal 2>&1")
  }
  out.push(
    "printf 'F:%s\\n' \"$(git -C " + quoted + " for-each-ref --format='%(refname):%(objectname)' refs/heads refs/remotes 2>/dev/null)\"",
    "printf 'H:%s\\n' \"$(git -C " + quoted + " rev-parse -q --verify HEAD 2>/dev/null)\"",
    "printf 'I:%s\\n' \"$(st \"$gd/index\")\"",
    /* The HEAD *file*, not just its stamp. Two branches can point at the same
       commit — `git switch -c` always does, and so does any pair left level by a
       fast-forward — and then the ref table, the HEAD sha and often the index are
       byte-identical, so the branch name written in this file is the only thing
       that tells them apart. A stamp is not enough on its own either: it carries
       second resolution, so a switch made in the same second as the previous read
       looks like nothing happened — and then never becomes visible at all. */
    "printf 'R:%s\\n' \"$(cat \"$gd/HEAD\" 2>/dev/null) $(st \"$gd/HEAD\")\"",
    "printf 'P:%s\\n' \"$(st \"$gd/packed-refs\")\"",
  )
  return out.join('\n')
}

function missingPanel(target, reason) {
  return {
    ok: false, repo: target, error: 'not-a-repository', reason: reason,
    stderr: '', exitCode: null, staged: [], unstaged: [], untracked: [], unmerged: [],
  }
}

async function readPanelIdentity(input, target) {
  const probe = await probeShell(input, panelIdentityCommand(target))
  const lines = probe.stdout.split('\n')
  const kind = lines.length > 0 ? lines[0] : ''
  if (kind === 'K:file') return missingPanel(target, 'file')
  if (kind !== 'K:dir') return missingPanel(target, 'missing')

  let exitCode = null
  let empty = false
  let sequencer = null
  let branch = null
  let upstream = null
  let track = ''
  const body = []
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.indexOf('RC:') === 0) { exitCode = parseInt(line.slice(3), 10); continue }
    if (line === 'E:1') { empty = true; continue }
    if (line === 'E:0') { empty = false; continue }
    if (line.indexOf('S:') === 0) { if (sequencer === null) sequencer = line.slice(2); continue }
    if (line.indexOf('B:') === 0) { branch = line.slice(2); continue }
    if (line.indexOf('U:') === 0) { upstream = line.slice(2); continue }
    if (line.indexOf('T:') === 0) { track = line.slice(2); continue }
    body.push(line)
  }
  if (exitCode !== 0) {
    const failed = missingPanel(target, empty ? 'empty-dir' : 'not-a-repo')
    failed.exitCode = exitCode
    failed.stderr = ''
    return failed
  }
  const counts = trackCounts(track)
  return {
    ok: true, repo: target, branch: branch, detached: branch === null,
    upstream: upstream !== null && upstream.length > 0 ? upstream : null,
    ahead: counts.ahead, behind: counts.behind,
    sequencer: sequencer,
    staged: [], unstaged: [], untracked: [], unmerged: [],
    /* Says outright that the working tree was not read, so nothing downstream
       can mistake "no changes" for "not asked". */
    partial: true,
  }
}

async function readPanel(input, target) {
  const probe = await probeShell(input, panelCommand(target))
  const lines = probe.stdout.split('\n')
  const kind = lines.length > 0 ? lines[0] : ''
  if (kind === 'K:file') return missingPanel(target, 'file')
  if (kind !== 'K:dir') return missingPanel(target, 'missing')

  let exitCode = null
  let empty = false
  let sequencer = null
  const body = []
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.indexOf('RC:') === 0) { exitCode = parseInt(line.slice(3), 10); continue }
    if (line === 'E:1') { empty = true; continue }
    if (line === 'E:0') { empty = false; continue }
    if (line.indexOf('S:') === 0) { if (sequencer === null) sequencer = line.slice(2); continue }
    body.push(line)
  }
  const output = body.join('\n')

  if (exitCode !== 0) {
    const outsideRepo = output.indexOf('not a git repository') >= 0
    const failed = missingPanel(target, outsideRepo ? (empty ? 'empty-dir' : 'not-a-repo') : 'git-error')
    failed.exitCode = exitCode
    failed.stderr = outsideRepo ? '' : output
    return failed
  }

  const parsed = parseStatusV2(output)
  const untracked = []
  for (let i = 0; i < parsed.untracked.length; i += 1) untracked.push({ path: parsed.untracked[i], code: '??' })
  return {
    ok: true, repo: target, branch: parsed.detached ? null : parsed.branch, detached: parsed.detached,
    upstream: parsed.upstream, ahead: parsed.ahead, behind: parsed.behind,
    sequencer: sequencer,
    staged: parsed.staged, unstaged: parsed.unstaged, untracked: untracked, unmerged: parsed.unmerged,
  }
}

async function panelSnapshot(input) {
  const target = repoFrom(input, null)
  if (target === undefined) return missingPanel(null, 'no-path')
  /* Two tags, never one: a cheap answer cached under the full read's name would
     hand an empty working tree to the changes tab. */
  if (input != null && input.quick === true) {
    return await cached(target, 'panel-ident', TTL_FOREVER, function () { return readPanelIdentity(input, target) })
  }
  return await cached(target, 'panel', TTL_FOREVER, function () { return readPanel(input, target) })
}

async function readGraph(input, repo) {
  const args = argsFor(input)
  const requested = input != null && typeof input.maxCount === 'number' && input.maxCount > 0 ? Math.floor(input.maxCount) : 200
  const maxCount = requested > 20000 ? 20000 : requested

  const head = await git(args, ['-c', 'core.quotePath=false', 'symbolic-ref', '--quiet', '--short', 'HEAD'], null, {})
  const currentBranch = head.exitCode === 0 ? head.stdout.trim() : null
  const allRefs = input != null && input.allRefs === true
  const asked = input != null && isStr(input.ref) && input.ref.trim().length > 0 ? input.ref.trim() : null
  const ref = asked !== null ? asked : (currentBranch !== null && currentBranch.length > 0 ? currentBranch : 'HEAD')

  const search = input != null && isStr(input.search) ? input.search.trim() : ''
  const author = input != null && isStr(input.author) ? input.author.trim() : ''
  const since = input != null && isStr(input.since) ? input.since.trim() : ''
  const until = input != null && isStr(input.until) ? input.until.trim() : ''
  const path = input != null && isStr(input.path) ? input.path.trim() : ''

  /* The two switches the log's search box carries, both off by default so the
     plain search is unchanged: `regex` hands the text to extended regexp
     instead of matching it literally, and `caseSensitive` drops git's `-i`. */
  const regex = input != null && input.regex === true
  const caseSensitive = input != null && input.caseSensitive === true

  /* One commit more than asked for: the extra row is not returned, it is how
     "there is more history" is answered without a second read. */
  const argv = ['-c', 'core.quotePath=false', 'log', '--max-count=' + String(maxCount + 1), '--date-order',
    '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1f%P%x1e']
  if ((search.length > 0 && regex !== true) || author.length > 0) argv.push('--fixed-strings')
  if (search.length > 0) {
    argv.push('--grep=' + search)
    if (regex === true) argv.push('--extended-regexp')
    if (caseSensitive !== true) argv.push('-i')
  }
  if (author.length > 0) argv.push('--author=' + author)
  if (since.length > 0) argv.push('--since=' + since)
  if (until.length > 0) argv.push('--until=' + until)
  if (allRefs) argv.push('--all')
  else argv.push(ref)
  if (path.length > 0) { argv.push('--'); argv.push(path) }

  const logged = await git(args, argv, null, {})
  if (logged.exitCode !== 0) {
    return { ok: false, repo: repo === undefined ? null : repo, error: 'not-a-repository', stderr: logged.stderr, currentBranch: currentBranch, ref: ref, commits: [], rows: [], lanes: 1 }
  }
  const parsed = parseCommitRecords(logged.stdout)
  const hasMore = parsed.length > maxCount
  const commits = hasMore ? parsed.slice(0, maxCount) : parsed
  const layout = layoutGraph(commits, 14)
  return {
    ok: true, repo: logged.cwd, currentBranch: currentBranch, ref: ref, allRefs: allRefs,
    commits: commits, rows: layout.rows, lanes: layout.lanes, hasMore: hasMore, maxCount: maxCount,
  }
}

function graphTag(input) {
  const part = function (value) { return value != null && isStr(value) ? value : '' }
  return 'graph|' + [
    input != null && input.allRefs === true ? '1' : '0',
    part(input != null ? input.ref : null),
    part(input != null ? input.search : null),
    input != null && input.regex === true ? 're' : '',
    input != null && input.caseSensitive === true ? 'cs' : '',
    part(input != null ? input.author : null),
    part(input != null ? input.since : null),
    part(input != null ? input.until : null),
    part(input != null ? input.path : null),
    input != null && typeof input.maxCount === 'number' ? String(input.maxCount) : '',
  ].join('\u0001')
}

async function graphSnapshot(input) {
  const repo = repoFrom(input, null)
  if (repo === undefined) return await readGraph(input, undefined)
  return await cached(repo, graphTag(input), TTL_FOREVER, function () { return readGraph(input, repo) })
}

async function readAuthors(input, repo) {
  const args = argsFor(input)
  const listed = await git(args, ['--no-pager', 'shortlog', '-sne', '--all'], null, { maxBytes: 200000 })
  if (listed.exitCode !== 0) {
    return { ok: false, repo: repo === undefined ? null : repo, error: 'not-a-repository', stderr: listed.stderr, authors: [] }
  }
  const authors = []
  const rows = listed.stdout.split('\n')
  for (let i = 0; i < rows.length && authors.length < 120; i += 1) {
    const row = rows[i]
    if (row.length === 0) continue
    const tab = row.indexOf('\t')
    if (tab < 0) continue
    const count = parseInt(row.slice(0, tab).trim(), 10) || 0
    const who = row.slice(tab + 1).trim()
    if (who.length === 0) continue
    const open = who.lastIndexOf('<')
    const close = who.lastIndexOf('>')
    const name = open > 0 ? who.slice(0, open).trim() : who
    const email = open >= 0 && close > open ? who.slice(open + 1, close).trim() : ''
    authors.push({ name: name, email: email, count: count })
  }
  return { ok: true, repo: listed.cwd, authors: authors }
}

/* shortlog walks the entire history for every author, so it is the most
   expensive read there is. It is deferred by the client to the history tab and
   then held until something invalidates it. */
async function authorsSnapshot(input) {
  const repo = repoFrom(input, null)
  if (repo === undefined) return await readAuthors(input, undefined)
  return await cached(repo, 'authors', TTL_FOREVER, function () { return readAuthors(input, repo) })
}

async function readRefs(input, repo) {
  const args = argsFor(input)
  /* The tracking columns matter as much as the names here: the tree is where a
     branch and its standing against its upstream are seen together, and the
     atoms are free once the command is running anyway. */
  /* `gitC`, not `git`: %(upstream:track) is a translated string and parsing it
     needs the same pinned locale the branch list already runs under. */
  const listed = await gitC(args, ['-c', 'core.quotePath=false', 'for-each-ref',
    '--format=%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(objectname:short)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:unix)',
    'refs/heads', 'refs/remotes'], null, {})
  if (listed.exitCode !== 0) {
    return { ok: false, repo: repo === undefined ? null : repo, error: 'not-a-repository', stderr: listed.stderr, current: [], local: [], remote: [] }
  }
  const local = []
  const current = []
  const remoteMap = new Map()
  const rows = listed.stdout.split('\n')
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].length === 0) continue
    const fields = rows[i].split('\u001f')
    const full = fields[0] === undefined ? '' : fields[0]
    const short = fields[1] === undefined ? '' : fields[1]
    const isCurrent = fields[2] === '*'
    if (full.indexOf('refs/heads/') === 0) {
      const counts = trackCounts(fields[5] === undefined ? '' : fields[5])
      local.push({
        segments: short.split('/'), data: short,
        upstream: fields[4] === undefined ? '' : fields[4],
        ahead: counts.ahead, behind: counts.behind,
        at: parseInt(fields[6], 10) || 0,
      })
      if (isCurrent) current.push(short)
    } else if (full.indexOf('refs/remotes/') === 0) {
      const slash = short.indexOf('/')
      const remoteName = slash < 0 ? short : short.slice(0, slash)
      const rest = slash < 0 ? short : short.slice(slash + 1)
      if (rest.length === 0 || rest === 'HEAD') continue
      if (!remoteMap.has(remoteName)) remoteMap.set(remoteName, [])
      remoteMap.get(remoteName).push({ segments: rest.split('/'), data: short })
    }
  }
  const remote = []
  remoteMap.forEach(function (entries, name) { remote.push({ name: name, refs: entries }) })
  return { ok: true, repo: listed.cwd, current: current, local: local, remote: remote }
}

async function refsSnapshot(input) {
  const repo = repoFrom(input, null)
  if (repo === undefined) return await readRefs(input, undefined)
  return await cached(repo, 'refs', TTL_FOREVER, function () { return readRefs(input, repo) })
}

/* "[ahead 2, behind 3]", "[behind 3]", "[gone]" — the words are English because
   gitC pins the locale, and only the numbers are wanted here. */
function trackCounts(raw) {
  const out = { ahead: 0, behind: 0 }
  const text = raw == null ? '' : String(raw)
  const a = text.indexOf('ahead ')
  if (a >= 0) out.ahead = parseInt(text.slice(a + 6), 10) || 0
  const b = text.indexOf('behind ')
  if (b >= 0) out.behind = parseInt(text.slice(b + 7), 10) || 0
  return out
}

/* The branch switcher's own list, which the panel's sidebar is not: it is
   ordered by when each branch last moved, and carries the things a chooser needs
   but a tree does not — how long ago it moved, what it tracks, how far ahead or
   behind that is, and where "the previous branch" is, so one row can undo a
   mistaken switch.

   Local and remote heads come from the same for-each-ref, so grouping them costs
   nothing extra. A remote branch that already has a local branch of the same
   name is dropped: the local row already names it as its upstream, and two rows
   that both mean "dev" would be one row too many.

   Two processes, once per repository per invalidation: the list, and rev-parse
   for @{-1}, which exits 128 (not a failure worth reporting) in a repository
   where nothing has been checked out yet. */
async function readBranches(input, repo) {
  const args = argsFor(input)
  const listed = await gitC(args, ['-c', 'core.quotePath=false', 'for-each-ref',
    '--format=%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(committerdate:unix)%1f%(upstream:short)%1f%(upstream:trackshort)%1f%(upstream:track)%1f%(objectname:short)%1f%(contents:subject)',
    '--sort=-committerdate', 'refs/heads', 'refs/remotes'], null, {})
  if (listed.exitCode !== 0) {
    return { ok: false, repo: repo === undefined ? null : repo, error: 'not-a-repository', stderr: listed.stderr, current: '', previous: '', branches: [], remotes: [] }
  }
  const branches = []
  const remoteRows = []
  const localNames = []
  let current = ''
  const rows = listed.stdout.split('\n')
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].length === 0) continue
    const fields = rows[i].split('\u001f')
    const full = fields[0] === undefined ? '' : fields[0]
    const short = fields[1] === undefined ? '' : fields[1]
    if (short.length === 0) continue
    const isCurrent = fields[2] === '*'
    /* parseInt and a truthiness test rather than Number/isFinite: the restricted
       Host realm is not the full JavaScript global scope, and parseInt is the one
       converter the rest of this file already relies on. */
    const stamp = parseInt(fields[3] === undefined ? '' : fields[3], 10)
    /* trackshort is symbols only (=, >, <, <>) and is never translated; the
       numbers beside it come from :track, whose words are pinned to C by gitC. */
    const counts = trackCounts(fields[6] === undefined ? '' : fields[6])
    const entry = {
      name: short,
      current: isCurrent,
      committedAt: stamp > 0 ? stamp : 0,
      upstream: fields[4] === undefined ? '' : fields[4],
      track: fields[5] === undefined ? '' : fields[5],
      ahead: counts.ahead,
      behind: counts.behind,
      head: fields[7] === undefined ? '' : fields[7],
      subject: fields[8] === undefined ? '' : fields[8],
    }
    if (full.indexOf('refs/heads/') === 0) {
      if (isCurrent) current = short
      localNames.push(short)
      branches.push(entry)
    } else if (full.indexOf('refs/remotes/') === 0) {
      const slash = short.indexOf('/')
      if (slash <= 0) continue
      const rest = short.slice(slash + 1)
      if (rest.length === 0 || rest === 'HEAD') continue
      remoteRows.push({
        name: rest, remote: short.slice(0, slash), ref: short,
        committedAt: entry.committedAt, head: entry.head, subject: entry.subject,
        ahead: 0, behind: 0,
      })
    }
  }
  const remotes = []
  for (let i = 0; i < remoteRows.length; i += 1) {
    if (localNames.indexOf(remoteRows[i].name) < 0) remotes.push(remoteRows[i])
  }
  const prev = await git(args, ['rev-parse', '--abbrev-ref', '@{-1}'], null, {})
  const previous = prev.exitCode === 0 ? prev.stdout.trim() : ''
  return {
    ok: true, repo: listed.cwd, current: current,
    previous: previous === 'HEAD' || previous === current ? '' : previous,
    branches: branches, remotes: remotes,
  }
}

async function branchesSnapshot(input) {
  const repo = repoFrom(input, null)
  if (repo === undefined) return await readBranches(input, undefined)
  return await cached(repo, 'branches', TTL_FOREVER, function () { return readBranches(input, repo) })
}

async function previousBranch(input) {
  const prev = await git(argsFor(input), ['rev-parse', '--abbrev-ref', '@{-1}'], null, {})
  if (prev.exitCode !== 0) return ''
  const name = prev.stdout.trim()
  return name === 'HEAD' ? '' : name
}

/* Switching with local changes in the way. git itself decides whether the
   changes actually conflict, so the cheap path is to try the switch first and
   only offer to stash when git refuses; stashing unconditionally would turn
   every switch of a dirty tree into two extra writes and one more chance to
   conflict on the way back.

   When the caller does ask for the stash, the failure paths matter more than
   the happy one: if the switch fails after the stash, the work goes back before
   the error is reported, because leaving someone's edits in a stash they never
   asked for is worse than the failed switch. A pop that conflicts is not hidden
   either — git keeps the stash entry in that case, and the caller says so. */
async function switchBranch(input, name) {
  const args = argsFor(input)
  const requested = repoFrom(input, null)
  const finish = function (result, extra) {
    invalidateRepo(requested !== undefined ? requested : result.cwd)
    const out = extra == null ? {} : extra
    out.ok = result.exitCode === 0
    out.repo = result.cwd
    out.stdout = result.stdout
    out.stderr = result.stderr
    out.exitCode = result.exitCode
    out.command = result.command
    return out
  }

  if (input == null || input.stash !== true) {
    const moved = await git(args, ['switch', name], null, {})
    return finish(moved, { stashed: false, dirty: 0, popConflict: false })
  }

  /* --no-optional-locks is a top-level option, so it has to sit before the
     subcommand: git status rejects it in its own option list. Without it this
     read fights the user's own `git add` for .git/index.lock. */
  const before = await git(args, ['--no-optional-locks', 'status', '--porcelain=v1', '--untracked-files=normal'], null, {})
  let dirty = 0
  const lines = before.stdout.split('\n')
  for (let i = 0; i < lines.length; i += 1) if (lines[i].length > 0) dirty += 1

  let stashed = false
  if (dirty > 0 && before.exitCode === 0) {
    const saved = await git(args, ['stash', 'push', '-u', '-m', 'dsh-git-idea: switch to ' + name], null, {})
    if (saved.exitCode !== 0) {
      return finish(saved, { stashed: false, dirty: dirty, popConflict: false, error: 'stash-failed' })
    }
    stashed = true
  }

  const moved = await git(args, ['switch', name], null, {})
  if (moved.exitCode !== 0) {
    let restored = false
    let restoreError = ''
    if (stashed) {
      const back = await git(args, ['stash', 'pop'], null, {})
      restored = back.exitCode === 0
      restoreError = restored ? '' : back.stderr
    }
    return finish(moved, {
      stashed: stashed, restored: restored, restoreError: restoreError,
      dirty: dirty, popConflict: false, error: 'switch-failed',
    })
  }

  let popConflict = false
  let popStdout = ''
  let popStderr = ''
  if (stashed) {
    const popped = await git(args, ['stash', 'pop'], null, {})
    popConflict = popped.exitCode !== 0
    /* Which stream git chooses is not stable — a conflicting pop narrates the
       merge on stdout and the failure on stderr — so both travel and the caller
       shows whichever has something in it. */
    popStdout = popped.stdout
    popStderr = popped.stderr
  }
  return finish(moved, {
    stashed: stashed, dirty: dirty, popConflict: popConflict,
    popStdout: popStdout, popStderr: popStderr,
  })
}

async function readCommitDetail(input) {
  const hash = input != null && isStr(input.hash) ? input.hash.trim() : ''
  if (hash.length === 0) return { ok: false, error: 'hash is required' }
  const args = argsFor(input)
  const meta = await git(args, ['-c', 'core.quotePath=false', 'show', '-s',
    '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b', hash], null, {})
  if (meta.exitCode !== 0) return { ok: false, error: 'commit-not-found', stderr: meta.stderr }
  const fields = meta.stdout.split('\u001f')

  const files = []
  const named = await git(args, ['-c', 'core.quotePath=false', 'show', '--name-status', '-z', '-M', '--first-parent', '--format=', hash], null, { maxBytes: 800000 })
  if (named.exitCode === 0) {
    const parts = named.stdout.split('\u0000')
    let index = 0
    while (index < parts.length) {
      const status = parts[index]
      if (status === undefined || status.length === 0) { index += 1; continue }
      const head = status.charAt(0)
      if (head === 'R' || head === 'C') {
        const from = parts[index + 1] === undefined ? '' : parts[index + 1]
        const to = parts[index + 2] === undefined ? '' : parts[index + 2]
        files.push({ status: status, path: to, from: from })
        index += 3
      } else {
        const path = parts[index + 1] === undefined ? '' : parts[index + 1]
        files.push({ status: status, path: path, from: null })
        index += 2
      }
    }
  }

  const branches = []
  const contains = await git(args, ['-c', 'core.quotePath=false', 'branch', '-a', '--contains', hash, '--format=%(refname:short)'], null, {})
  if (contains.exitCode === 0) {
    const rows = contains.stdout.split('\n')
    for (let i = 0; i < rows.length; i += 1) if (rows[i].length > 0) branches.push(rows[i])
  }

  return {
    ok: true,
    hash: fields[0] === undefined ? hash : fields[0],
    short: fields[1] === undefined ? '' : fields[1],
    author: fields[2] === undefined ? '' : fields[2],
    email: fields[3] === undefined ? '' : fields[3],
    date: fields[4] === undefined ? '' : fields[4],
    subject: fields[5] === undefined ? '' : fields[5],
    body: fields[6] === undefined ? '' : fields[6].replace(/\s+$/, ''),
    files: files,
    branches: branches,
  }
}

/* A commit is immutable, so its detail is held until the repository is mutated
   (which cannot rewrite an existing hash, so this only frees memory). */
async function commitDetailSnapshot(input) {
  const hash = input != null && isStr(input.hash) ? input.hash.trim() : ''
  if (hash.length === 0) return { ok: false, error: 'hash is required' }
  const repo = repoFrom(input, null)
  if (repo === undefined) return await readCommitDetail(input)
  return await cached(repo, 'detail|' + hash, TTL_FOREVER, function () { return readCommitDetail(input) })
}

async function panelMutate(input, argv, options) {
  const opts = options == null ? {} : options
  const requested = repoFrom(input, null)
  const runner = opts.net === true ? gitNet : git
  const result = await runner(argsFor(input), argv, null, opts.spawn == null ? {} : opts.spawn)
  /* Unconditionally, not only on success: a conflicting cherry-pick, merge or
     revert changes the index and the working tree and then exits non-zero, so
     gating on exitCode === 0 would leave the panel showing the pre-conflict
     state and hide the very banner that gets the user out of it. */
  invalidateRepo(requested !== undefined ? requested : result.cwd)
  return {
    ok: result.exitCode === 0, repo: result.cwd, stdout: result.stdout,
    stderr: result.stderr, exitCode: result.exitCode, command: result.command,
  }
}

function panelPaths(input) {
  return input != null && Array.isArray(input.paths) ? input.paths.filter(isStr) : []
}

