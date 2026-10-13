/* Every request the Client can make, in one table. Each handler is registered
   through `ctx.effect` so it belongs to this fiber: stopping or updating the
   Package removes all of them, which is what makes the bridge's reload safe.

   Each one waits for the plugin config before the handler runs, because the
   config decides which binary every command in this plugin starts with
   (`gitExe` — see 72-gitbin.js) and command lines are built synchronously inside
   the handlers. One cached read for the life of the process: the first request
   pays for it, and a "which git" answer can never be half-applied. */
/* ── 请求里的路径，在会话工作区里吗 ──

   客户端递来的 `repo` 一直被当成「它就是会话工作区」用（`repoFrom` 里的 `input.repo`）。
   加上仓库清单之后，那个路径可以来自扫描结果之外的任何地方，而这条通道读的是**整台
   机器上的仓库** —— 所以每一个请求都在这里过一遍：不在工作区里（也不是一棵已知工作
   树）的路径不当路径用，只把「它被拒了」这件事交给处理函数（见 69-repos.js 的
   `repoOutsideWorkspace`）。换掉而不是抛错，是因为处理函数还得回答得了：面板要说
   是哪个路径被拒、为什么。 */
function refuseOutsideRepo(input) {
  if (!repoOutsideWorkspace(input)) return input
  const next = Object.assign({}, input)
  delete next.repo
  next.repoRefused = isStr(input.repo) ? input.repo : ''
  return next
}

function onRpc(name, handler) {
  ctx.effect(function () {
    return harness.handle(name, function (input) {
      return readConfigFile()
        .then(function () { return withSessionRepo(input) })
        .then(refuseOutsideRepo)
        .then(function (resolved) { return handler(resolved) })
    })
  }, 'dsh-git-idea rpc ' + name)
}

onRpc('git/panel', function (input) { return panelSnapshot(input) })

onRpc('git/init', function (input) { return initSnapshot(input) })

/* The client's refresh button must be able to force a re-read; without this it
   would only repaint whatever the read cache already held. */
onRpc('git/flush', function (input) {
  invalidateRepo(repoFrom(input, null))
  /* 那个 ⟳ 也重扫工作区：屏幕上现在看的是某一个仓库，而「这个工作区里有哪几个仓库」
     是另一个问题（新克隆下来的项目要能出现），它缓存在工作区那个键下面。 */
  const workspace = sessionWorkdir(input)
  if (isStr(workspace) && workspace.length > 0) invalidateRepo(workspace)
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
  /* 带上会话：这份文件在任何工作区之外，写它的策略来自这个会合（`sandboxFor`）。
     没有会话时拿到的是部署默认那份（workspace-write），写到 ~/.dsh 会被拒 —— 而现在
     被拒会在答复里说出来，不再是一个安静的 no-op。 */
  return writeConfigFile(input != null ? input.config : null, argsAt(input, null))
})

/* The two machine-level questions the settings page asks: which git, and who
   commits. Both are reads of the world outside the repository and neither is
   cached — the reader opening this page is asking "now", not "a moment ago". */
onRpc('git/toolchain', function () { return toolchainSnapshot() })

onRpc('git/identity', function (input) { return identitySnapshot(input) })

/* The one mutation that is not about the repository at all: it writes the
   reader's own name and address into git's configuration. Explicit button, named
   scope, and nothing is written for a box left empty. */
onRpc('git/identity-save', function (input) { return identitySave(input) })

/* Never cached: its whole purpose is to observe change. `paths` narrows the
   working-tree half of the signature to what is on screen — see watchCommand for
   what a whole-tree status costs on a slow mount. */
onRpc('git/watch', function (input) {
  const target = repoFrom(input, null)
  if (target === undefined) return { ok: false, repo: null, sig: '' }
  const deep = input != null && input.deep === true
  const paths = deep ? readPaths(input) : []
  return probeShell(input, watchCommand(target, deep, paths)).then(function (probe) {
    return { ok: true, repo: target, sig: probe.stdout, paths: paths }
  })
})

onRpc('git/graph', function (input) { return graphSnapshot(input) })

onRpc('git/authors', function (input) { return authorsSnapshot(input) })

onRpc('git/refs', function (input) { return refsSnapshot(input) })

onRpc('git/branches', function (input) { return branchesSnapshot(input) })

/* 只读的工作树清单：DSH 自己会建树（`create_worktree`），这个插件只把它建出来
   的东西说清楚 —— 树上有什么、当前在哪一棵、源仓库的哪条改动是工作树池。 */
onRpc('git/worktrees', function (input) { return worktreesSnapshot(input) })

/* 这个工作区里有哪几个仓库：一次向下找 `.git` 的扫描，一个进程、不起 git（见
   69-repos.js）。答案是「这个工作区」的属性，不是「当前这个仓库」的：请求里的 `repo`
   只用来对照，扫描永远从会话工作区开始。 */
onRpc('git/repos', function (input) { return reposSnapshot(input) })

onRpc('git/commit-detail', function (input) { return commitDetailSnapshot(input) })

/* The one read the panel asks for by path rather than by repository: the patch
   behind a row in the changes tree or in a commit's file list. Never cached —
   it is the live text of a file the reader is looking at. */
onRpc('git/diff', function (input) { return readFileDiff(input) })

/* git collapses an untracked directory into a single entry; this is what is
   inside it, asked for only when the reader opens that row. */
onRpc('git/untracked', function (input) { return readUntrackedTree(input) })

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

/* A failed commit is the one mutation whose failure can be about this machine
   instead of about the repository: git will not author a commit until it knows
   who the author is, and no amount of retrying here changes that. Asked of git
   itself, once, and only after the commit has already been refused — see
   `identityMissing`. The flag rides the same reply as `noGit` and
   `sandboxDenied`, so the client has one place to read all three.

   Which mutations go through here is decided at the call site, because only the
   call site knows whether the command writes a commit object. `git add`,
   `git branch -d` and the aborts all run on a machine with no identity at all —
   hanging "this machine has no identity" on one of those would send the reader
   to fix something that is not broken. */
async function commitMutation(input, argv, options) {
  const result = await panelMutate(input, argv, options)
  if (result.ok !== true) result.needsIdentity = await identityMissing(argsFor(input))
  return result
}

onRpc('git/commit', function (input) {
  const message = input != null && isStr(input.message) ? input.message.trim() : ''
  if (message.length === 0) return { ok: false, error: 'a commit message is required' }
  if (input != null && input.stageAll === true) {
    return panelMutate(input, ['add', '-A']).then(function (staged) {
      if (staged.ok !== true) return staged
      return commitMutation(input, ['commit', '-m', message])
    })
  }
  return commitMutation(input, ['commit', '-m', message])
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

/* The three arguments this plugin chooses about the network, each read from the
   plugin config at the moment it is used: `fetch --all` prunes only if asked,
   `pull` merges unless the reader prefers rebase, and a push to a branch with no
   upstream is left to the panel's own "set upstream and push" row unless the
   reader asked for it to just happen. git's own `push.default` and `pull.rebase`
   are not overridden — these are the flags this plugin adds on top. */
async function netConfig() {
  return await readConfigFile()
}

/* ── 一个远端都没配的仓库 ──

   `git fetch --all` 在没有远端的仓库里是**退出码 0、一个字都不说**的：它只是没有
   对象可取。面板原来把这个答复当成功，于是那颗按钮看起来像是坏的 —— 按下去，什么都
   没有发生，也没有一句话。pull 和 push 会失败，但说出来的是 git 自己的英文建议
   （"There is no tracking information for the current branch"、"No configured push
   destination"），两条路都只通向终端 —— 而这个面板连「有没有远端」都不知道。

   所以这三个动作都先问一遍「配了哪些远端」（见 66-refs.js 的 `readRemoteNames`：
   ref 列表答不了这个问题），一个都没有就自己回答：不起 git，也不假装成功。答复里那句
   话由客户端的 `commandDetail` 说，和「找不到 git」「身份缺失」同一个去处。 */
function noRemoteReply(input) {
  const requested = repoFrom(input, null)
  return {
    ok: false, repo: requested === undefined ? null : requested,
    error: 'no-remote', stdout: '', stderr: '', exitCode: null, command: '',
    sandboxDenied: false, noGit: false,
  }
}

async function noRemoteConfigured(input) {
  return (await readRemoteNames(argsFor(input))).length === 0
}

/* 「缺上游」是 pull 和 push 才可能有的事（fetch 不关心），而且由 git 自己判定 ——
   见 10-shell.js 的 `upstreamMissing`，只在已经失败之后问。 */
async function upstreamFlag(input, result) {
  if (result.ok !== true) result.needsUpstream = await upstreamMissing(argsFor(input))
  return result
}

function netRefuse(input, message) {
  const requested = repoFrom(input, null)
  return {
    ok: false, repo: requested === undefined ? null : requested,
    error: 'bad-request', stdout: '', stderr: message, exitCode: null, command: '',
    sandboxDenied: false, noGit: false,
  }
}

onRpc('git/fetch', async function (input) {
  const config = await netConfig()
  if (await noRemoteConfigured(input)) return noRemoteReply(input)
  return panelMutate(input, config.fetchPrune === true ? ['fetch', '--all', '--prune'] : ['fetch', '--all'], { net: true, spawn: NET_SPAWN })
})

onRpc('git/pull', async function (input) {
  const config = await netConfig()
  const argv = config.pullRebase === true ? ['pull', '--rebase'] : ['pull']
  /* 没有上游的分支，面板可以一键补上：`--set-upstream` 拉的同时把这条跟踪关系写进
     git 的配置（git 2.24 起支持），下一步就不用再问。 */
  if (input != null && input.setUpstream === true) {
    const remote = input != null && isStr(input.remote) && input.remote.trim().length > 0 ? input.remote.trim() : ''
    const branch = input != null && isStr(input.branch) ? input.branch.trim() : ''
    if (remote.length === 0) return noRemoteReply(input)
    if (branch.length === 0) return netRefuse(input, '要设上游，得先知道是哪条分支。')
    /* A pull that merges writes a commit, so the identity can be what failed. */
    return await upstreamFlag(input, await commitMutation(input, argv.concat(['--set-upstream', remote, branch]), { net: true, spawn: NET_SPAWN }))
  }
  if (await noRemoteConfigured(input)) return noRemoteReply(input)
  /* A pull that merges writes a commit, so the identity can be what failed. */
  return await upstreamFlag(input, await commitMutation(input, argv, { net: true, spawn: NET_SPAWN }))
})

onRpc('git/push', async function (input) {
  if (input != null && input.setUpstream === true) {
    const remote = input != null && isStr(input.remote) && input.remote.trim().length > 0 ? input.remote.trim() : ''
    const branch = input != null && isStr(input.branch) ? input.branch.trim() : ''
    if (remote.length === 0) return noRemoteReply(input)
    if (branch.length === 0) return netRefuse(input, '要设上游，得先知道是哪条分支。')
    return panelMutate(input, ['push', '-u', remote, branch], { net: true, spawn: NET_SPAWN })
  }
  if (await noRemoteConfigured(input)) return noRemoteReply(input)
  /* A push does not write a commit, so there is no identity to be the reason here. */
  return await upstreamFlag(input, await panelMutate(input, ['push'], { net: true, spawn: NET_SPAWN }))
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
      return commitMutation(input, ['merge', '--no-edit', target])
    }
    if (action === 'continue') return commitMutation(input, ['commit', '--no-edit'])
    if (action === 'abort') return panelMutate(input, ['merge', '--abort'])
    return { ok: false, error: 'merge supports start, continue and abort' }
  }

  if (action === 'start') {
    if (target.length === 0) return { ok: false, error: 'a commit is required' }
    if (op === 'revert') return commitMutation(input, ['revert', '--no-edit', target])
    if (input != null && input.record === true) return commitMutation(input, ['cherry-pick', '-x', target])
    return commitMutation(input, ['cherry-pick', target])
  }
  if (action === 'continue') return commitMutation(input, ['-c', 'core.editor=true', op, '--continue'])
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
