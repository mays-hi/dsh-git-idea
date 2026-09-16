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
  if (spec.indexOf('refs/heads/') === 0) spec = spec.slice('refs/heads/'.length)
  return PROTECTED_BRANCHES.indexOf(spec) >= 0
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

