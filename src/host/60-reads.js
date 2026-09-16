/* ─────────────── Client RPC ─────────────── */

/* ── whose working directory this request means ──

   A request that names no path of its own is about the session's own working
   directory, which is exactly the directory the shell layer already treats as
   home when no workdir is given. Both questions below are that one lookup: which
   repository this request is about, and where a probe of some *other* path may be
   spawned. A probe must never run with the inspected path as its workdir — when
   that directory does not exist the spawn itself fails before git is ever reached
   and the caller sees a rejected promise instead of the diagnosis it asked for. */
function sessionWorkdir(input) {
  if (input == null || !isStr(input.sessionId)) return undefined
  const sessions = ctx.get('sessions')
  if (sessions === undefined) return undefined
  try {
    const session = sessions.get(input.sessionId)
    const header = session != null ? session.header : undefined
    const cwd = header != null ? header.cwd : undefined
    if (isStr(cwd) && cwd.length > 0) return cwd
  } catch (error) {
    console.error('dsh-git-idea: could not resolve the session working directory', String(error))
  }
  return undefined
}

function repoFrom(input) {
  if (input != null && isStr(input.repo) && input.repo.trim().length > 0) return input.repo.trim()
  return sessionWorkdir(input)
}

/* Which repository, and on whose behalf. The session id travels with the args so
   the shell layer can ask for that session's sandbox policy — it is the only
   thing that says whether these commands may write at all (see `sandboxFor`).

   Every path that builds these args goes through here, including the ones that
   resolved a path of their own: a request that keeps the repo and drops the
   session id runs under the *deployment* default policy instead of the reader's
   own, which is how `git init` came to be denied on a directory nobody had a
   problem writing to. */
function argsAt(input, repo) {
  const out = repo === undefined || repo === null ? {} : { repo: repo }
  if (input != null && isStr(input.sessionId) && input.sessionId.length > 0) out.sessionId = input.sessionId
  return out
}

function argsFor(input) {
  return argsAt(input, repoFrom(input))
}

/* ─────────────── per-repository read cache ───────────────

   Opening the panel used to cost nine child processes and nothing was reused,
   so every open re-read the whole repository. Reads are now memoised per
   repository and dropped on any mutation.

   Reads do not age out on a timer. Data may be as old as the last explicit
   invalidation, which is what makes reopening the panel instant; freshness is
   the watcher's job (git/watch below) plus the mutation and refresh paths.

   A miss stores the *promise*, not the value: two surfaces asking for the same
   read at the same moment — the composer chip's full read, and the panel opening
   under it — are one child process instead of two, which on a slow mount is the
   difference between one seven-second `git status` and two. A rejection is never
   kept, so a read that failed can be attempted again, and the value is only
   stored if the entry is still the promise that produced it: an invalidation
   arriving mid-read must not be undone by that read landing afterwards. */

const readCache = new Map()
const READ_CACHE_MAX = 300

async function cached(repo, tag, loader) {
  const key = repo + '\u0000' + tag
  const hit = readCache.get(key)
  if (hit !== undefined) return await hit
  const pending = loader()
  readCache.set(key, pending)
  try {
    const value = await pending
    if (readCache.get(key) === pending) readCache.set(key, value)
    return value
  } catch (error) {
    if (readCache.get(key) === pending) readCache.delete(key)
    throw error
  }
}

function invalidateRepo(repo) {
  if (repo === undefined || repo === null) { readCache.clear(); return }
  const prefix = repo + '\u0000'
  const doomed = []
  readCache.forEach(function (_value, key) {
    if (key.indexOf(prefix) === 0) doomed.push(key)
  })
  for (let i = 0; i < doomed.length; i += 1) readCache.delete(doomed[i])
  /* Oldest first, one key at a time. Clearing the whole map on overflow meant one
     repository's paging dropped every other repository's reads with it. */
  while (readCache.size > READ_CACHE_MAX) readCache.delete(readCache.keys().next().value)
}

/* Diagnostics for the "this path is not a repository" setup page. The workdir is
   the session's own directory, never the path being inspected (see
   `sessionWorkdir`). */
async function probeShell(input, command) {
  return await invoke(command, argsAt(input, sessionWorkdir(input)), null, { timeoutMs: 20000 })
}

async function pathKind(input, target) {
  const probe = await probeShell(input, 'if [ -d ' + shq(target) + ' ]; then echo dir; elif [ -f ' + shq(target) + ' ]; then echo file; else echo none; fi')
  const kind = probe.stdout.trim()
  return kind === 'dir' || kind === 'file' ? kind : 'none'
}

/* One shell process answers everything the setup page needs: whether the path
   exists, what it is, git's own status with its exit code carried out
   explicitly, and whether an operation is caught half-done. The previous shape
   cost two or three spawns for the same information. */
/* ── the cheap half of a panel read ──

   `git status` stats every tracked file. On a Windows-mounted worktree of a few
   thousand files that is the whole cost of opening the panel: measured on one
   here, 7.0s for the status against 0.13s for the four commands below. Nothing
   in the composer chip, and nothing in the panel's frame, needs the working
   tree — they need to know whether this path is a repository, which branch it is
   on, where that branch stands against its upstream, and whether a cherry-pick,
   merge or rebase is half-done. The working tree is asked for separately, by the
   request that actually shows it. */
/* ── one directory, no discovery ──

   A workspace is a repository when **that directory** is one: `$dir/.git` (a
   directory, or the file a worktree and a submodule keep there). Git's own
   discovery would instead walk up and answer for whatever repository happens to
   be above — the panel would name another project's branch, its watcher would
   follow that repository's refs, and the answer for a bare subdirectory would
   silently be about a tree the reader never pointed at. So every command below
   tests that one path and stops there; nothing looks upward, and nothing looks
   into the directory either. */
function repoHere(target) {
  return '[ -e ' + shq(target) + '/.git ]'
}

/* The five states in which an operation is caught half-done. Both reads below ask
   for all of them, and they have to stay in step: a state known to one and not
   the other is a panel that offers "continue" on one screen and not the next. */
function sequencerShell() {
  return [
    "    [ -e \"$gd/CHERRY_PICK_HEAD\" ] && printf 'S:cherry-pick\\n'",
    "    [ -e \"$gd/REVERT_HEAD\" ] && printf 'S:revert\\n'",
    "    [ -e \"$gd/MERGE_HEAD\" ] && printf 'S:merge\\n'",
    "    [ -d \"$gd/rebase-merge\" ] && printf 'S:rebase\\n'",
    "    [ -d \"$gd/rebase-apply\" ] && printf 'S:rebase\\n'",
  ].join('\n')
}

/* The branch half of the identity read, in one git process instead of three.

   The branch name comes out of `$gd/HEAD` itself rather than out of
   `symbolic-ref`: the gitdir is already in hand, the answer is the one line in
   that file, and the spawn cost a quarter of this read. Reading it also answers
   the case for-each-ref cannot — a repository whose branch has no commit yet
   names that branch, while `refs/heads` is still empty.

   Then one for-each-ref, restricted to that branch, carries the upstream and the
   ahead/behind numbers together. Asking for them separately re-walked the same
   ref table for nothing, and asking for *all* branches instead is far worse than
   it looks: `%(upstream:track)` costs a rev-list pair per branch, 109ms against
   31ms for the single branch on screen on the repository this was measured
   against.

   LC_ALL=C is not decoration either: the words around those numbers are
   translated, and this is the read the composer chip shows. */
function branchIdentityShell(target) {
  return [
    "    b=''",
    '    if [ -f "$gd/HEAD" ]; then',
    '      read -r headline < "$gd/HEAD"',
    '      case "$headline" in',
    "        'ref: refs/heads/'*) b=${headline#'ref: refs/heads/'} ;;",
    '      esac',
    '    fi',
    '    if [ -n "$b" ]; then',
    "      printf 'B:%s\\n' \"$b\"",
    "      printf 'U:%s\\n' \"$(LC_ALL=C git -C " + shq(target) + " for-each-ref --format='%(upstream:short)%1f%(upstream:track)' \"refs/heads/$b\" 2>/dev/null)\"",
    '    fi',
  ].join('\n')
}

/* The shape both reads share: the three answers about the path itself, the one
   gitdir both of them need, and the half-done-operation markers — with everything
   that is actually asked of the repository in the middle. Written once because
   the two commands have to keep answering the same way about the same path, and
   only their middles should ever differ. */
function pathShell(target, middle) {
  const quoted = shq(target)
  return [
    'if [ -d ' + quoted + ' ]; then',
    "  printf 'K:dir\\n'",
    /* Guarded by `repoHere` and not left to git: without the guard,
       `git rev-parse` in a directory that is not a repository walks up and
       answers for a parent one. */
    '  if ' + repoHere(target) + '; then',
    '    gd=$(git -C ' + quoted + ' rev-parse --absolute-git-dir 2>/dev/null)',
    '  else',
    "    gd=''",
    '  fi',
    middle,
    'elif [ -f ' + quoted + ' ]; then',
    "  printf 'K:file\\n'",
    'else',
    "  printf 'K:none\\n'",
    'fi',
  ].join('\n')
}

function panelIdentityCommand(target) {
  return pathShell(target, [
    '  if [ -z "$gd" ]; then',
    "    printf 'RC:1\\n'",
    "    printf 'fatal: not a git repository\\n'",
    '  else',
    branchIdentityShell(target),
    sequencerShell(),
    "    printf 'RC:0\\n'",
    '  fi',
  ].join('\n'))
}

/* ── reading by pathspec instead of by tree ──

   `git status` stats every tracked file and walks every untracked directory, and
   on a Windows-mounted worktree that is the whole cost of every read this plugin
   makes. Measured on the reader's repository, one whole-tree status: 7.4s
   (13.6s cold), 5.3s with `-uno`, 13.0s with `--untracked-files=all`. The same
   command asked about the 36 paths the changes tree was showing: **0.5s**. The
   working tree is what the panel is showing, so the reads that keep it fresh ask
   about those paths, and only a read that has to answer for the whole tree pays
   for the whole tree.

   The paths come from the client, so each one passes the guard the diff read
   uses (relative, inside the repository, no NUL), and the list is capped: a
   pathspec list is a command line, and a command line has a length. */
const READ_PATHS_MAX = 200

function readPaths(input) {
  if (input == null || !Array.isArray(input.paths)) return []
  const out = []
  for (let i = 0; i < input.paths.length && out.length < READ_PATHS_MAX; i += 1) {
    const path = input.paths[i]
    if (!isStr(path) || path.length === 0) continue
    if (repoRelativePath(path) !== '') continue
    if (out.indexOf(path) >= 0) continue
    out.push(path)
  }
  return out
}

function pathspecSuffix(paths) {
  if (paths.length === 0) return ''
  return ' -- ' + paths.map(shq).join(' ')
}

function panelCommand(target, paths) {
  const quoted = shq(target)
  const asked = paths == null ? [] : paths
  return pathShell(target, [
    '  if ' + repoHere(target) + '; then',
    "    out=$(git -C " + quoted + " --no-optional-locks -c core.quotePath=false status --porcelain=v2 --branch --untracked-files=normal" + pathspecSuffix(asked) + " 2>&1); rc=$?",
    '  else',
    "    out='fatal: not a git repository'; rc=1",
    '  fi',
    "  printf '%s\n' \"$out\"",
    "  printf 'RC:%s\n' \"$rc\"",
    '  if [ -n "$gd" ]; then',
    sequencerShell(),
    '  fi',
  ].join('\n'))
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
   this machine: 15 of 150 adds failed without the flag, 0 of 150 with it, and
   the reported status is identical either way.

   The rule is not "this one call": it is every read this plugin makes. The full
   panel read and the `git_status` tool missed it for a while and were caught by
   a case of exactly this — a fetch that triggered auto-gc was blamed first, but
   background gc never touches index.lock (it runs pack-objects --indexed-objects,
   which only reads the index). Whoever writes .git/index is the suspect, and a
   `git status` writes it. `test/gp34a` now holds both the rule and the probe. */
/* What "did anything move?" costs. The status is the expensive part — seconds
   on a slow mount, every tick — and it is only worth paying while something is
   showing the working tree, which is what `deep` asks for. Everything else in
   the signature is three stats, one for-each-ref and one small file read. */
function watchCommand(target, deep, paths) {
  const quoted = shq(target)
  const asked = paths == null ? [] : paths
  /* Every git call below is inside `[ -n "$gd" ]`: on a directory that is not a
     repository, git would happily answer for one of its parents, and the
     signature would then follow a tree this workspace does not own. */
  const whenRepo = function (command) {
    return '$(if [ -n "$gd" ]; then ' + command + '; fi)'
  }
  const out = [
    "st() { stat -c '%Y:%s' \"$1\" 2>/dev/null || stat -f '%m:%z' \"$1\" 2>/dev/null; }",
    'if ' + repoHere(target) + '; then',
    '  gd=$(git -C ' + quoted + ' rev-parse --absolute-git-dir 2>/dev/null)',
    'else',
    "  gd=''",
    'fi',
  ]
  if (deep === true) {
    /* ── the tick asks about the paths on screen ──
       This runs every few seconds while the changes tab is open, and a
       whole-tree status is 7.4s on the reader's mount: the tick then takes
       longer than the interval between ticks, so the poller never stops and
       every cheap read beside it (for-each-ref went 50ms → 143ms) waits behind
       it. The same command over the paths the tree was showing is 0.5s. A file
       that was clean and is now modified is the one thing this cannot see; the
       panel reads the whole tree for that on its own clock. */
    out.push('if [ -n "$gd" ]; then git -C ' + quoted + ' --no-optional-locks -c core.quotePath=false status --porcelain=v2 --branch --untracked-files=normal' + pathspecSuffix(asked) + ' 2>&1; fi')
  }
  out.push(
    "printf 'F:%s\\n' \"" + whenRepo("git -C " + quoted + " for-each-ref --format='%(refname):%(objectname)' refs/heads refs/remotes 2>/dev/null") + "\"",
    "printf 'H:%s\\n' \"" + whenRepo("git -C " + quoted + " rev-parse -q --verify HEAD 2>/dev/null") + "\"",
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
  let sequencer = null
  let branch = null
  let upstream = null
  let track = ''
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.indexOf('RC:') === 0) { exitCode = parseInt(line.slice(3), 10); continue }
    if (line.indexOf('S:') === 0) { if (sequencer === null) sequencer = line.slice(2); continue }
    if (line.indexOf('B:') === 0) { branch = line.slice(2); continue }
    /* The upstream and its standing arrive in one line, separated by the same
       \u001f the rest of the Host uses: one for-each-ref answers both. */
    if (line.indexOf('U:') === 0) {
      const fields = line.slice(2).split('\u001f')
      upstream = fields[0] === undefined ? '' : fields[0]
      track = fields[1] === undefined ? '' : fields[1]
    }
  }
  if (exitCode !== 0) {
    const failed = missingPanel(target, 'not-a-repo')
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

async function readPanel(input, target, paths) {
  const asked = paths == null ? [] : paths
  const probe = await probeShell(input, panelCommand(target, asked))
  const lines = probe.stdout.split('\n')
  const kind = lines.length > 0 ? lines[0] : ''
  if (kind === 'K:file') return missingPanel(target, 'file')
  if (kind !== 'K:dir') return missingPanel(target, 'missing')

  let exitCode = null
  let sequencer = null
  const body = []
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.indexOf('RC:') === 0) { exitCode = parseInt(line.slice(3), 10); continue }
    if (line.indexOf('S:') === 0) { if (sequencer === null) sequencer = line.slice(2); continue }
    body.push(line)
  }
  const output = body.join('\n')

  if (exitCode !== 0) {
    const outsideRepo = output.indexOf('not a git repository') >= 0
    const failed = missingPanel(target, outsideRepo ? 'not-a-repo' : 'git-error')
    failed.exitCode = exitCode
    failed.stderr = outsideRepo ? '' : output
    return failed
  }

  const parsed = parseStatusV2(output)
  const untracked = []
  for (let i = 0; i < parsed.untracked.length; i += 1) untracked.push({ path: parsed.untracked[i], code: '??' })
  const reply = {
    ok: true, repo: target, branch: parsed.detached ? null : parsed.branch, detached: parsed.detached,
    upstream: parsed.upstream, ahead: parsed.ahead, behind: parsed.behind,
    sequencer: sequencer,
    staged: parsed.staged, unstaged: parsed.unstaged, untracked: untracked, unmerged: parsed.unmerged,
  }
  /* A pathspec answer is about those paths and nothing else. It says so, and it
     names them, so the client can fold it into the snapshot it already has
     instead of mistaking it for the whole working tree. The whole-tree answer
     carries neither key — the same convention the identity read uses. */
  if (asked.length > 0) {
    reply.partial = true
    reply.paths = asked
  }
  return reply
}

async function panelSnapshot(input) {
  const target = repoFrom(input, null)
  if (target === undefined) return missingPanel(null, 'no-path')
  /* Two tags, never one: a cheap answer cached under the full read's name would
     hand an empty working tree to the changes tab. */
  if (input != null && input.quick === true) {
    return await cached(target, 'panel-ident', function () { return readPanelIdentity(input, target) })
  }
  const paths = readPaths(input)
  if (paths.length > 0) {
    /* A partial answer is cached under the question it answered: same paths, same
       tag. Any mutation drops it with the rest of this repository's entries. */
    return await cached(target, 'panel|' + paths.join('\u0001'), function () { return readPanel(input, target, paths) })
  }
  return await cached(target, 'panel', function () { return readPanel(input, target, []) })
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
  return await cached(repo, graphTag(input), function () { return readGraph(input, repo) })
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
  return await cached(repo, 'authors', function () { return readAuthors(input, repo) })
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
  return await cached(repo, 'refs', function () { return readRefs(input, repo) })
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
  return await cached(repo, 'branches', function () { return readBranches(input, repo) })
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
    out.sandboxDenied = result.sandboxDenied === true
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
  return await cached(repo, 'detail|' + hash, function () { return readCommitDetail(input) })
}

/* ── one file's change ──

   The panel could say *which* files changed and nothing else. The changes tree
   and the file list under a commit both ended on a dead row: there was no read
   that returned a patch, so a file could be reported as modified and never shown
   as modified. This is that read.

   Four modes, because that is what the two lists can be looking at: the index
   against HEAD (`staged`), the working tree against the index (`worktree`), one
   commit (`commit`, with the old path of a rename travelling along — with only
   the new path as a pathspec git reports the file as newly added instead), and a
   file git has never seen (`untracked`, the one case with no HEAD side at all,
   which needs `--no-index`).

   Nothing is cached. The text is live, and the reader looking at it is the one
   who just edited the file. `--no-color` because there is no terminal to read
   colour, `--no-ext-diff` because a configured diff driver is not a viewer, and
   `core.quotePath=false` so a non-ASCII path arrives as itself.

   `--no-optional-locks` is the same rule every read here follows, and here it is
   load-bearing rather than decorative: measured on this box after `touch f` made
   the cached stat stale, a plain `git diff` rewrote `.git/index` in 2 of 20 runs
   while the flagged one did 0 of 20 (`git status` writes 20 of 20) — a read that
   may refresh the index may also take the lock, occasionally being exactly the
   case that hurts. */
const DIFF_MODES = ['worktree', 'staged', 'commit', 'untracked']
const DIFF_LINES_MAX = 6000
const DIFF_CHARS_MAX = 400000
const DIFF_SHA = /^[0-9a-f]{7,40}$/i

function diffArgv(mode, paths, ref) {
  const common = ['--no-optional-locks', '-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff']
  if (mode === 'commit') {
    /* `-m --first-parent` is what makes a merge commit readable: without it git
       prints the combined diff, which for a clean merge is empty — the file list
       would name a change and the patch would say there is none. */
    return ['--no-optional-locks', '-c', 'core.quotePath=false', 'show', '--no-color', '--no-ext-diff',
      '--format=', '--patch', '-m', '--first-parent', ref, '--'].concat(paths)
  }
  if (mode === 'untracked') return common.concat(['--no-index', '--', '/dev/null', paths[0]])
  if (mode === 'staged') return common.concat(['--cached', '--']).concat(paths)
  return common.concat(['--']).concat(paths)
}

/* The two numbers IDEA puts in the corner of a file row. `---`/`+++` are the
   file headers rather than a removed and an added line. */
function patchCounts(patch) {
  let added = 0
  let removed = 0
  const lines = patch.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i].charAt(0)
    if (head === '+') { if (lines[i].indexOf('+++') !== 0) added += 1; continue }
    if (head === '-') { if (lines[i].indexOf('---') !== 0) removed += 1; continue }
  }
  return { added: added, removed: removed }
}

/* A patch that is not text is not shown as text. A new binary file is printed by
   git as its own bytes when the file happens to contain no NUL — measured here —
   and a byte string with a NUL in it cannot survive being handed to a renderer
   at all, so both are reported as "binary" with no body. */
function patchLooksBinary(patch) {
  if (patch.indexOf('\u0000') >= 0) return true
  if (/^Binary files /m.test(patch)) return true
  if (/^GIT binary patch/m.test(patch)) return true
  return patchHasControlBytes(patch)
}

/* git decides "binary" from the first 8000 bytes, so a NUL-free blob is printed
   as if it were text: measured here, 400 random bytes came back as one 524-byte
   line of noise. Text does not carry C0 control characters, and a handful is
   enough to tell. */
function patchHasControlBytes(patch) {
  let seen = 0
  for (let i = 0; i < patch.length; i += 1) {
    const code = patch.charCodeAt(i)
    if (code === 9 || code === 10 || code === 13) continue
    if (code < 32 || code === 127) {
      seen += 1
      if (seen > 8) return true
    }
  }
  return false
}

async function readFileDiff(input) {
  const mode = input != null && isStr(input.mode) ? input.mode.trim() : ''
  if (DIFF_MODES.indexOf(mode) < 0) {
    return { ok: false, error: 'unknown-mode', exitCode: null, stderr: 'mode must be one of ' + DIFF_MODES.join(', ') }
  }
  const path = input != null && isStr(input.path) ? input.path : ''
  const bad = repoRelativePath(path)
  if (bad.length > 0) return { ok: false, error: 'invalid-path', exitCode: null, stderr: bad }

  const from = input != null && isStr(input.from) ? input.from : ''
  const ref = input != null && isStr(input.ref) ? input.ref.trim() : ''
  if (mode === 'commit' && !DIFF_SHA.test(ref)) {
    return { ok: false, error: 'invalid-ref', exitCode: null, stderr: 'a commit hash is required' }
  }
  const paths = from.length > 0 && from !== path ? [from, path] : [path]

  const result = await git(argsFor(input), diffArgv(mode, paths, ref), null, { maxBytes: 1200000 })
  /* `git diff --no-index` says "these differ" with exit code 1 and a perfectly
     good patch on stdout; every other mode says it with exit code 0. */
  const produced = result.exitCode === 0 || (mode === 'untracked' && result.exitCode === 1 && result.stdout.length > 0)
  if (!produced) {
    return { ok: false, error: 'diff-failed', exitCode: result.exitCode, stderr: result.stderr, mode: mode, path: path }
  }

  const binary = patchLooksBinary(result.stdout)
  const counts = binary ? { added: 0, removed: 0 } : patchCounts(result.stdout)
  let patch = binary ? '' : result.stdout
  let truncated = result.truncated === true
  const lines = patch.split('\n')
  if (lines.length > DIFF_LINES_MAX) {
    patch = lines.slice(0, DIFF_LINES_MAX).join('\n')
    truncated = true
  }
  if (patch.length > DIFF_CHARS_MAX) {
    patch = patch.slice(0, DIFF_CHARS_MAX)
    truncated = true
  }
  return {
    ok: true, mode: mode, path: path, from: from, ref: ref,
    text: patch, added: counts.added, removed: counts.removed,
    binary: binary, truncated: truncated, empty: patch.length === 0,
    exitCode: result.exitCode,
  }
}

/* ── what is inside an untracked directory ──

   git reports an untracked directory as one entry ending in "/" and says nothing
   about what is in it, which is exactly why the panel could not show those files:
   it had nothing to show. Ticking the row needs no answer (`git add -- dir`
   takes the whole thing); opening it is a second, deliberate act, and that is the
   right moment to pay — `-uall` on a repository with one large untracked tree is
   the cost git's own collapsing exists to avoid.

   `ls-files --others --exclude-standard` lists the files `git add <dir>` would
   take, honours .gitignore the same way, and is a read: `--no-optional-locks`,
   no index write. Not cached — the directory is the thing most likely to be
   changing while the reader looks at it. */
const UNTRACKED_FILES_MAX = 2000

async function readUntrackedTree(input) {
  const raw = input != null && isStr(input.dir) ? input.dir : ''
  const dir = raw.replace(/\/+$/, '')
  const bad = repoRelativePath(dir)
  if (bad.length > 0) return { ok: false, error: 'invalid-path', stderr: bad }
  const result = await git(argsFor(input), ['--no-optional-locks', '-c', 'core.quotePath=false',
    'ls-files', '--others', '--exclude-standard', '-z', '--', dir], null, { maxBytes: 800000 })
  if (result.exitCode !== 0) {
    return { ok: false, error: 'ls-files-failed', exitCode: result.exitCode, stderr: result.stderr, dir: dir }
  }
  const files = []
  const parts = result.stdout.split('\u0000')
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].length > 0 && files.length < UNTRACKED_FILES_MAX) files.push(parts[i])
  }
  return {
    ok: true, dir: dir, files: files,
    truncated: result.truncated === true || parts.length > UNTRACKED_FILES_MAX + 1,
  }
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
    /* Says outright that the file sandbox refused the write, so the reader is not
       left reading git's "Permission denied" as a problem with their repository. */
    sandboxDenied: result.sandboxDenied === true,
  }
}

function panelPaths(input) {
  return input != null && Array.isArray(input.paths) ? input.paths.filter(isStr) : []
}

