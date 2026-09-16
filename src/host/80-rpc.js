/* Every request the Client can make, in one table. Each handler is registered
   through `ctx.effect` so it belongs to this fiber: stopping or updating the
   Package removes all of them, which is what makes the bridge's reload safe. */
function onRpc(name, handler) {
  ctx.effect(function () { return harness.handle(name, handler) }, 'dsh-git-idea rpc ' + name)
}

onRpc('git/panel', function (input) { return panelSnapshot(input) })

onRpc('git/init', function (input) { return initSnapshot(input) })

/* The client's refresh button must be able to force a re-read; without this it
   would only repaint whatever the read cache already held. */
onRpc('git/flush', function (input) {
  invalidateRepo(repoFrom(input, null))
  return { ok: true }
})

onRpc('git/config', function () {
  return configPath().then(function (path) {
    return readConfigFile().then(function (config) {
      return { ok: true, path: path, config: config }
    })
  })
})

onRpc('git/config-save', function (input) {
  return writeConfigFile(input != null ? input.config : null)
})

/* Never cached: its whole purpose is to observe change. */
onRpc('git/watch', function (input) {
  const target = repoFrom(input, null)
  if (target === undefined) return { ok: false, repo: null, sig: '' }
  const deep = input != null && input.deep === true
  return probeShell(input, watchCommand(target, deep)).then(function (probe) {
    return { ok: true, repo: target, sig: probe.stdout }
  })
})

onRpc('git/graph', function (input) { return graphSnapshot(input) })

onRpc('git/authors', function (input) { return authorsSnapshot(input) })

onRpc('git/refs', function (input) { return refsSnapshot(input) })

onRpc('git/branches', function (input) { return branchesSnapshot(input) })

onRpc('git/commit-detail', function (input) { return commitDetailSnapshot(input) })

/* The one read the panel asks for by path rather than by repository: the patch
   behind a row in the changes tree or in a commit's file list. Never cached —
   it is the live text of a file the reader is looking at. */
onRpc('git/diff', function (input) { return readFileDiff(input) })

onRpc('git/stage', function (input) {
  const paths = panelPaths(input)
  if (paths.length === 0) return { ok: false, error: 'no paths given' }
  return panelMutate(input, ['add', '--'].concat(paths))
})

onRpc('git/unstage', function (input) {
  const paths = panelPaths(input)
  if (paths.length === 0) return { ok: false, error: 'no paths given' }
  return panelMutate(input, ['restore', '--staged', '--'].concat(paths))
})

onRpc('git/commit', function (input) {
  const message = input != null && isStr(input.message) ? input.message.trim() : ''
  if (message.length === 0) return { ok: false, error: 'a commit message is required' }
  if (input != null && input.stageAll === true) {
    return panelMutate(input, ['add', '-A']).then(function (staged) {
      if (staged.ok !== true) return staged
      return panelMutate(input, ['commit', '-m', message])
    })
  }
  return panelMutate(input, ['commit', '-m', message])
})

onRpc('git/checkout', async function (input) {
  const name = input != null && isStr(input.name) ? input.name.trim() : ''
  if (name.length === 0) return { ok: false, error: 'a branch name is required' }
  /* `-` is git's own shorthand for the previous branch; resolve it here so the
     caller never has to know that the switcher's "previous" row and this
     argument are the same idea. */
  let target = name
  if (name === '-') {
    target = await previousBranch(input)
    if (target.length === 0) return { ok: false, error: 'there is no previous branch to switch back to' }
  }
  return await switchBranch(input, target)
})

const NET_SPAWN = { timeoutMs: 180000 }

onRpc('git/fetch', function (input) {
  return panelMutate(input, ['fetch', '--all', '--prune'], { net: true, spawn: NET_SPAWN })
})

onRpc('git/pull', function (input) {
  return panelMutate(input, ['pull'], { net: true, spawn: NET_SPAWN })
})

onRpc('git/push', function (input) {
  if (input != null && input.setUpstream === true) {
    const remote = input != null && isStr(input.remote) && input.remote.trim().length > 0 ? input.remote.trim() : ''
    const branch = input != null && isStr(input.branch) ? input.branch.trim() : ''
    if (remote.length === 0) return { ok: false, error: 'no remote is configured to push to' }
    if (branch.length === 0) return { ok: false, error: 'a branch is required to set an upstream' }
    return panelMutate(input, ['push', '-u', remote, branch], { net: true, spawn: NET_SPAWN })
  }
  return panelMutate(input, ['push'], { net: true, spawn: NET_SPAWN })
})

/* cherry-pick, revert and merge share one entry point because they also share
   the way they stop half-done: continue, skip or abort has to be reachable or a
   conflicted panel would trap the user with no way back. */
const SEQUENCER_OPS = ['cherry-pick', 'revert', 'merge']

onRpc('git/sequence', function (input) {
  const op = input != null && isStr(input.op) ? input.op : ''
  const action = input != null && isStr(input.action) ? input.action : ''
  const target = input != null && isStr(input.target) ? input.target.trim() : ''
  if (SEQUENCER_OPS.indexOf(op) < 0) return { ok: false, error: 'unknown operation ' + op }

  if (op === 'merge') {
    if (action === 'start') {
      if (target.length === 0) return { ok: false, error: 'a branch or commit is required to merge' }
      return panelMutate(input, ['merge', '--no-edit', target])
    }
    if (action === 'continue') return panelMutate(input, ['commit', '--no-edit'])
    if (action === 'abort') return panelMutate(input, ['merge', '--abort'])
    return { ok: false, error: 'merge supports start, continue and abort' }
  }

  if (action === 'start') {
    if (target.length === 0) return { ok: false, error: 'a commit is required' }
    if (op === 'revert') return panelMutate(input, ['revert', '--no-edit', target])
    if (input != null && input.record === true) return panelMutate(input, ['cherry-pick', '-x', target])
    return panelMutate(input, ['cherry-pick', target])
  }
  if (action === 'continue') return panelMutate(input, ['-c', 'core.editor=true', op, '--continue'])
  if (action === 'abort') return panelMutate(input, [op, '--abort'])
  if (action === 'skip') return panelMutate(input, [op, '--skip'])
  return { ok: false, error: op + ' does not support ' + action }
})

onRpc('git/branch-create', function (input) {
  const name = input != null && isStr(input.name) ? input.name.trim() : ''
  if (name.length === 0) return { ok: false, error: 'a branch name is required' }
  const at = input != null && isStr(input.at) ? input.at.trim() : ''
  if (at.length > 0) return panelMutate(input, ['switch', '-c', name, at])
  return panelMutate(input, ['switch', '-c', name])
})

onRpc('git/branch-delete', function (input) {
  const name = input != null && isStr(input.name) ? input.name.trim() : ''
  if (name.length === 0) return { ok: false, error: 'a branch name is required' }
  const force = input != null && input.force === true
  return panelMutate(input, ['branch', force ? '-D' : '-d', name])
})

onRpc('git/tag', function (input) {
  const name = input != null && isStr(input.name) ? input.name.trim() : ''
  if (name.length === 0) return { ok: false, error: 'a tag name is required' }
  const at = input != null && isStr(input.at) ? input.at.trim() : ''
  if (at.length > 0) return panelMutate(input, ['tag', name, at])
  return panelMutate(input, ['tag', name])
})

  },
}
