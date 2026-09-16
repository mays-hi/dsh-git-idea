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

