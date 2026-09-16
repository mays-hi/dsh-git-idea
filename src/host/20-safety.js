/* ─────────────── safety classification ─────────────── */

const READ_ONLY_SUBCOMMANDS = [
  'status', 'diff', 'log', 'show', 'blame', 'grep', 'shortlog', 'describe',
  'rev-parse', 'rev-list', 'ls-files', 'ls-tree', 'cat-file', 'for-each-ref',
  'show-ref', 'diff-tree', 'diff-index', 'diff-files', 'merge-base', 'name-rev',
  'symbolic-ref', 'var', 'version', 'check-ignore', 'check-attr', 'whatchanged',
  'range-diff', 'cherry', 'fsck', 'count-objects', 'verify-commit', 'verify-tag',
]

const PROTECTED_BRANCHES = ['main', 'master']

function scanArgv(argv) {
  let index = 0
  while (index < argv.length) {
    const token = argv[index]
    if (token === '-C' || token === '-c' || token === '--git-dir' || token === '--work-tree'
      || token === '--namespace' || token === '--exec-path' || token === '--config-env') {
      index += 2
      continue
    }
    if (isStr(token) && token.length > 1 && token.charAt(0) === '-') {
      index += 1
      continue
    }
    break
  }
  return { sub: argv[index], rest: argv.slice(index + 1) }
}

function hasAny(list, names) {
  for (let i = 0; i < names.length; i += 1) if (list.indexOf(names[i]) >= 0) return true
  return false
}

function shortFlag(list, letters) {
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i]
    if (!isStr(token) || token.length < 2 || token.charAt(0) !== '-' || token.charAt(1) === '-') continue
    const body = token.slice(1)
    for (let j = 0; j < letters.length; j += 1) if (body.indexOf(letters[j]) >= 0) return letters[j]
  }
  return null
}

function refspecTargetsProtected(refspec) {
  let spec = refspec.charAt(0) === '+' ? refspec.slice(1) : refspec
  const colon = spec.lastIndexOf(':')
  if (colon >= 0) spec = spec.slice(colon + 1)
  return isProtectedBranch(spec)
}

/* "main", "heads/main" and "refs/heads/main" are one ref written three ways, and
   git accepts all three. Only the longest spelling was recognised here, so a
   force push written `-f origin heads/main` classified as merely destructive
   instead of forbidden — the rule read as if it held while the ref it names went
   through. */
function bareBranchName(name) {
  let spec = name
  if (spec.indexOf('refs/') === 0) spec = spec.slice('refs/'.length)
  if (spec.indexOf('heads/') === 0) spec = spec.slice('heads/'.length)
  return spec
}

function isProtectedBranch(name) {
  return PROTECTED_BRANCHES.indexOf(bareBranchName(name)) >= 0
}

/* ── a value is not an option ──

   The structured tools hand caller strings straight into git's argv: a revision,
   a path, a remote, a branch name. A string that starts with "-" is not that
   value any more — git reads it as an option and the tool does something else
   entirely. Measured on this deployment: `git_sync` with branch "--force" ran
   `git push origin --force` (a force push with no confirmation), `git_log` with
   ref "--output=/tmp/x" wrote an empty log to that path and returned nothing, and
   `git_branch` with name "--force" ran `git branch --force`. The escape hatch
   has a classifier for this because its argv is open-ended; the named arguments
   here only need the one rule. */
function optionLike(fields) {
  for (let i = 0; i < fields.length; i += 1) {
    const value = fields[i][1]
    if (isStr(value) && value.length > 0 && value.charAt(0) === '-') {
      return {
        field: fields[i][0],
        value: value,
        reason: fields[i][0] + ' may not start with "-" (' + value + ' would be read by git as an option, not as a value)',
      }
    }
  }
  return null
}

/* ── a path that stays inside the repository ──

   Every path the panel sends is one git itself listed, so it is relative to the
   work-tree root. Three of the four diff reads pass it as a pathspec, which git
   keeps inside the repository on its own. The untracked read cannot: it is
   `git diff --no-index -- /dev/null <path>`, and that command reads whatever the
   path names. Measured here, an absolute path came back with the contents of
   /etc/hostname — a file no reader of a git panel asked for. So anything
   absolute, or stepping up with "..", is refused rather than resolved. */
function repoRelativePath(path) {
  if (!isStr(path) || path.length === 0) return 'path is required'
  if (path.charAt(0) === '/' || path.charAt(0) === '\\') return 'path must be relative to the repository root'
  if (path.length > 1 && path.charAt(1) === ':') return 'path must be relative to the repository root'
  if (path.indexOf('\u0000') >= 0) return 'path may not contain a NUL byte'
  const parts = path.split(/[\\/]/)
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] === '..') return 'path may not step outside the repository'
  }
  return ''
}

function classify(argv) {
  const scan = scanArgv(argv)
  const sub = scan.sub
  const rest = scan.rest
  if (sub === undefined) return { level: 'read', why: '' }

  if (sub === 'filter-branch' || sub === 'filter-repo') {
    return { level: 'forbidden', why: sub + ' rewrites published history and is never allowed through this tool' }
  }
  if (sub === 'update-ref' && hasAny(rest, ['-d', '--delete'])) {
    return { level: 'forbidden', why: 'update-ref -d deletes refs directly, bypassing every safety net' }
  }
  if (sub === 'reflog' && rest[0] === 'expire') {
    return { level: 'forbidden', why: 'reflog expire destroys the log that makes mistakes recoverable' }
  }
  if (sub === 'gc' && rest.some(function (token) { return isStr(token) && token.indexOf('--prune') === 0 })) {
    return { level: 'forbidden', why: 'gc --prune destroys unreachable objects permanently' }
  }

  const reasons = []
  if (sub === 'reset' && hasAny(rest, ['--hard'])) reasons.push('reset --hard discards working-tree changes')
  if (sub === 'clean' && (hasAny(rest, ['-f', '--force']) || shortFlag(rest, 'f') !== null)) reasons.push('clean -f deletes untracked files')
  if (sub === 'checkout' && (hasAny(rest, ['-f', '--force']) || shortFlag(rest, 'f') !== null)) reasons.push('checkout --force discards local changes')
  if ((sub === 'checkout' || sub === 'restore') && rest.indexOf('.') >= 0) reasons.push('restoring "." discards every working-tree change')
  if (sub === 'switch' && hasAny(rest, ['-f', '--force', '--discard-changes'])) reasons.push('switch --force discards local changes')
  if (sub === 'branch' && (shortFlag(rest, 'D') !== null || (hasAny(rest, ['--delete']) && hasAny(rest, ['--force'])))) reasons.push('force-deleting a branch discards unmerged commits')
  if (sub === 'stash' && rest[0] === 'clear') reasons.push('stash clear drops every stash entry')
  if (sub === 'stash' && rest[0] === 'drop') reasons.push('stash drop discards a stash entry')
  if (sub === 'reflog' && rest[0] === 'delete') reasons.push('reflog delete removes recovery entries')
  if (sub === 'worktree' && rest[0] === 'remove' && hasAny(rest, ['-f', '--force'])) reasons.push('worktree remove --force deletes a worktree that still has changes')
  if (sub === 'submodule' && rest[0] === 'deinit' && hasAny(rest, ['-f', '--force'])) reasons.push('submodule deinit --force removes a submodule checkout')
  if (sub === 'tag' && hasAny(rest, ['-d', '--delete'])) reasons.push('deleting a tag removes a published reference')
  if (argv.indexOf('--no-verify') >= 0) reasons.push('--no-verify skips the repository hooks')

  if (sub === 'push') {
    const positional = rest.filter(function (token) { return isStr(token) && token.charAt(0) !== '-' })
    const refspecs = positional.slice(1)
    const forced = hasAny(rest, ['--force', '--mirror']) || shortFlag(rest, 'f') !== null
    const leased = rest.some(function (token) { return isStr(token) && token.indexOf('--force-with-lease') === 0 })
    const deleting = hasAny(rest, ['--delete']) || refspecs.some(function (token) { return token.charAt(0) === ':' })
    if (forced && refspecs.some(refspecTargetsProtected)) {
      return { level: 'forbidden', why: 'force-pushing to a protected branch (main/master) is never allowed' }
    }
    if (forced) reasons.push('push --force overwrites remote history')
    if (leased) reasons.push('push --force-with-lease overwrites remote history')
    if (deleting) reasons.push('push --delete removes a remote reference')
    if (refspecs.some(function (token) { return token.charAt(0) === '+' })) reasons.push('a "+" refspec forces the remote update')
  }

  if (reasons.length > 0) return { level: 'destructive', why: reasons.join('; ') }
  if (READ_ONLY_SUBCOMMANDS.indexOf(sub) >= 0) return { level: 'read', why: '' }
  return { level: 'write', why: '' }
}

