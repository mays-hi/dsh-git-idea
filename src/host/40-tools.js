/* ─────────────── tool registration ─────────────── */

function define(name, definition) {
  definition.name = name
  ctx.effect(function () {
    return harness.registerTool(ctx, harness.defineTool(definition))
  }, 'dsh-git-idea tool ' + name)
}

define('git', {
  description: 'Run any git command as a token array: the complete escape hatch behind the structured git_* tools. There is no argument allowlist, so every git subcommand works (clone, init, worktree, submodule, bisect, tag, merge, rebase, cherry-pick, revert, blame, gc, ...). Destructive commands are refused unless confirm: true is also passed. Always check the reported exit code.',
  parameters: {
    args: {
      type: 'array',
      items: { type: 'string' },
      required: true,
      description: 'git arguments as separate tokens, WITHOUT the leading "git". Example: ["log", "--oneline", "-n", "5"].',
    },
    repo: { type: 'string', description: 'Repository directory. Defaults to the session working directory.' },
    stdin: { type: 'string', description: 'Text piped to git standard input.' },
    timeoutMs: { type: 'number', description: 'Timeout in milliseconds. Default 120000.' },
    confirm: { type: 'boolean', description: 'Must be true to allow a destructive command. Without it the command is refused and nothing runs.' },
  },
  output: {
    schema: { type: 'json' },
    render: function (_args, value) { return [{ type: 'text', text: renderPassthrough(value) }] },
  },
  isConcurrencySafe: function (args) {
    return classify(Array.isArray(args.args) ? args.args.filter(isStr) : []).level === 'read'
  },
  execute: async function (args, exec) {
    const argv = Array.isArray(args.args) ? args.args.filter(isStr) : []
    const cwd = here(args, exec)
    if (argv.length === 0) {
      return { ok: false, blocked: 'invalid-args', reason: 'args must hold at least one git token, e.g. ["status"]', command: 'git', cwd: cwd }
    }
    const verdict = classify(argv)
    if (verdict.level === 'forbidden') {
      return { ok: false, blocked: 'forbidden', reason: verdict.why, command: 'git ' + argv.join(' '), cwd: cwd }
    }
    if (verdict.level === 'destructive' && args.confirm !== true) {
      return { ok: false, blocked: 'confirmation-required', reason: verdict.why, command: 'git ' + argv.join(' '), cwd: cwd }
    }
    const options = {}
    if (isStr(args.stdin)) options.stdin = args.stdin
    if (typeof args.timeoutMs === 'number') options.timeoutMs = args.timeoutMs
    return await git(args, argv, exec, options)
  },
})

define('git_status', {
  description: 'Structured repository status: current branch, detached state, upstream, ahead/behind counts, and the staged, unstaged, untracked and unmerged file lists. Reads git status --porcelain=v2, so it is stable across git versions.',
  parameters: {
    repo: { type: 'string', description: 'Repository directory. Defaults to the session working directory.' },
  },
  output: {
    schema: { type: 'json' },
    render: function (_args, value) { return [{ type: 'text', text: renderStatus(value) }] },
  },
  isConcurrencySafe: function () { return true },
  execute: async function (args, exec) {
    const result = await git(args, ['-c', 'core.quotePath=false', 'status', '--porcelain=v2', '--branch', '--untracked-files=all'], exec, {})
    if (result.exitCode !== 0) {
      return { ok: false, cwd: result.cwd, exitCode: result.exitCode, stderr: result.stderr, error: 'not-a-repository' }
    }
    const parsed = parseStatusV2(result.stdout)
    parsed.ok = true
    parsed.cwd = result.cwd
    parsed.exitCode = result.exitCode
    parsed.clean = parsed.staged.length === 0 && parsed.unstaged.length === 0 && parsed.untracked.length === 0 && parsed.unmerged.length === 0
    parsed.stderr = result.stderr
    return parsed
  },
})

define('git_log', {
  description: 'Structured commit history: hash, short hash, author, ISO date, subject line and the refs each commit carries. Supports a revision range, a path filter and a result cap.',
  parameters: {
    repo: { type: 'string', description: 'Repository directory. Defaults to the session working directory.' },
    maxCount: { type: 'number', description: 'Maximum commits to return. Default 20, hard cap 200.' },
    ref: { type: 'string', description: 'Revision or range to walk, e.g. "HEAD", "main..feature", "v1.0.0". Default HEAD.' },
    path: { type: 'string', description: 'Limit history to one path.' },
  },
  output: {
    schema: { type: 'json' },
    render: function (_args, value) { return [{ type: 'text', text: renderLog(value) }] },
  },
  isConcurrencySafe: function () { return true },
  execute: async function (args, exec) {
    const requested = typeof args.maxCount === 'number' && args.maxCount > 0 ? Math.floor(args.maxCount) : 20
    const maxCount = requested > 200 ? 200 : requested
    const argv = ['-c', 'core.quotePath=false', 'log', '--max-count=' + String(maxCount), '--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%D%x1e']
    if (isStr(args.ref) && args.ref.trim().length > 0) argv.push(args.ref.trim())
    if (isStr(args.path) && args.path.trim().length > 0) { argv.push('--'); argv.push(args.path.trim()) }
    const result = await git(args, argv, exec, {})
    if (result.exitCode !== 0) {
      return { ok: false, cwd: result.cwd, exitCode: result.exitCode, stderr: result.stderr, error: 'log-failed' }
    }
    const commits = []
    const records = result.stdout.split('\u001e')
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i].replace(/^\n+/, '')
      if (record.length === 0) continue
      const fields = record.split('\u001f')
      const rawDate = fields[3] === undefined ? '' : fields[3]
      commits.push({
        hash: fields[0] === undefined ? '' : fields[0],
        short: fields[1] === undefined ? '' : fields[1],
        author: fields[2] === undefined ? '' : fields[2],
        date: rawDate.length >= 16 ? rawDate.slice(0, 16).replace('T', ' ') : rawDate,
        subject: fields[4] === undefined ? '' : fields[4],
        refs: fields[5] === undefined ? '' : fields[5],
      })
    }
    return { ok: true, cwd: result.cwd, exitCode: result.exitCode, count: commits.length, commits: commits, stderr: result.stderr }
  },
})

define('git_diff', {
  description: 'Diff between two repository states, returning the changed file list plus full before/after content so the UI renders a native diff card. modes: "worktree" (index vs working tree), "staged" (HEAD vs index), "commit" (ref against its first parent), "range" (ref..to). Narrow with paths for a large change set: above maxFiles the card is skipped and the raw unified patch is returned instead.',
  parameters: {
    repo: { type: 'string', description: 'Repository directory. Defaults to the session working directory.' },
    mode: { type: 'string', required: true, enum: ['worktree', 'staged', 'commit', 'range'], description: 'Which two states to compare.' },
    ref: { type: 'string', description: 'Base revision: for "commit" the commit to show (default HEAD); for "range" the range start.' },
    to: { type: 'string', description: 'Range end. Required for mode "range".' },
    paths: { type: 'array', items: { type: 'string' }, description: 'Limit the diff to these paths.' },
    maxFiles: { type: 'number', description: 'Maximum files to build the diff card for. Default 12, cap 50.' },
  },
  output: {
    schema: { type: 'json' },
    render: function (_args, value) { return [{ type: 'text', text: renderDiff(value) }] },
    presentationMeta: function (_args, value) {
      return { mode: value.mode, cardAvailable: value.cardAvailable === true, diffs: value.files }
    },
  },
  isConcurrencySafe: function () { return true },
  presentResult: function (_args, result) {
    if (result == null || result.isError === true) return undefined
    const meta = result.meta
    if (meta == null || meta.cardAvailable !== true) return undefined
    const diffs = Array.isArray(meta.diffs) ? meta.diffs : []
    if (diffs.length === 0) return undefined
    return { card: 'diff', title: 'git diff (' + String(meta.mode) + ')', diffs: diffs }
  },
  execute: async function (args, exec) {
    const mode = isStr(args.mode) ? args.mode : 'worktree'
    const requested = typeof args.maxFiles === 'number' && args.maxFiles > 0 ? Math.floor(args.maxFiles) : 12
    const maxFiles = requested > 50 ? 50 : requested
    const paths = Array.isArray(args.paths) ? args.paths.filter(isStr) : []
    const ref = isStr(args.ref) && args.ref.trim().length > 0 ? args.ref.trim() : 'HEAD'
    const to = isStr(args.to) && args.to.trim().length > 0 ? args.to.trim() : null
    const suffix = paths.length > 0 ? ['--'].concat(paths) : []

    let listArgv
    let patchArgv
    let oldSpec
    let newSpec
    let fromWorktree = false

    if (mode === 'worktree') {
      listArgv = ['-c', 'core.quotePath=false', 'diff', '--name-only', '--no-renames', '-z'].concat(suffix)
      patchArgv = ['-c', 'core.quotePath=false', 'diff', '--no-color', '-U3'].concat(suffix)
      oldSpec = function (path) { return ':' + path }
      fromWorktree = true
    } else if (mode === 'staged') {
      listArgv = ['-c', 'core.quotePath=false', 'diff', '--cached', '--name-only', '--no-renames', '-z'].concat(suffix)
      patchArgv = ['-c', 'core.quotePath=false', 'diff', '--cached', '--no-color', '-U3'].concat(suffix)
      oldSpec = function (path) { return 'HEAD:' + path }
      newSpec = function (path) { return ':' + path }
    } else if (mode === 'commit') {
      listArgv = ['-c', 'core.quotePath=false', 'show', '--name-only', '--no-renames', '-z', '--format=', ref].concat(suffix)
      patchArgv = ['-c', 'core.quotePath=false', 'show', '--no-color', '-U3', '--format=', ref].concat(suffix)
      oldSpec = function (path) { return ref + '^:' + path }
      newSpec = function (path) { return ref + ':' + path }
    } else if (mode === 'range') {
      if (to === null) return { ok: false, cwd: here(args, exec), error: 'mode "range" needs a "to" revision' }
      listArgv = ['-c', 'core.quotePath=false', 'diff', '--name-only', '--no-renames', '-z', ref + '..' + to].concat(suffix)
      patchArgv = ['-c', 'core.quotePath=false', 'diff', '--no-color', '-U3', ref + '..' + to].concat(suffix)
      oldSpec = function (path) { return ref + ':' + path }
      newSpec = function (path) { return to + ':' + path }
    } else {
      return { ok: false, cwd: here(args, exec), error: 'unknown mode ' + mode }
    }

    const listed = await git(args, listArgv, exec, {})
    if (listed.exitCode !== 0) {
      return { ok: false, cwd: listed.cwd, exitCode: listed.exitCode, stderr: listed.stderr, error: 'diff-failed' }
    }
    const names = parseNulList(listed.stdout)
    const result = {
      ok: true, cwd: listed.cwd, exitCode: listed.exitCode, mode: mode,
      paths: names, files: [], cardAvailable: false, truncated: false, patch: null, note: null, stderr: listed.stderr,
    }
    if (names.length === 0) { result.note = 'no differences in this mode'; return result }

    if (names.length > maxFiles) {
      const patch = await git(args, patchArgv, exec, { maxBytes: 400000 })
      result.patch = patch.stdout
      result.note = String(names.length) + ' files changed, more than maxFiles=' + String(maxFiles) + '; pass paths to narrow the diff and get the diff card'
      return result
    }

    const files = []
    let total = 0
    let cut = false
    let overLimit = false
    for (let i = 0; i < names.length; i += 1) {
      const path = names[i]
      const rawOld = await readBlob(args, oldSpec(path), exec)
      let rawNew = null
      if (fromWorktree) rawNew = await readWorktreeFile(args, path, exec)
      else rawNew = await readBlob(args, newSpec(path), exec)
      const oldCapped = rawOld === null ? null : capText(rawOld)
      const newCapped = capText(rawNew === null ? '' : rawNew)
      if ((oldCapped !== null && oldCapped.cut) || newCapped.cut) cut = true
      total += (oldCapped === null ? 0 : oldCapped.text.length) + newCapped.text.length
      files.push({ path: path, oldText: oldCapped === null ? null : oldCapped.text, newText: newCapped.text })
      if (total > CARD_TOTAL_LIMIT) { overLimit = true; break }
    }
    result.truncated = cut
    if (overLimit) {
      const patch = await git(args, patchArgv, exec, { maxBytes: 400000 })
      result.patch = patch.stdout
      result.note = 'the combined before/after content is too large for the diff card; the raw patch is returned instead'
      return result
    }
    result.files = files
    result.cardAvailable = true
    return result
  },
})

define('git_commit', {
  description: 'Stage and commit in one step. By default it commits exactly what is already staged; pass paths to stage only those paths first, or all: true to stage every change. Reports the new commit hash.',
  parameters: {
    repo: { type: 'string', description: 'Repository directory. Defaults to the session working directory.' },
    message: { type: 'string', required: true, description: 'Commit message. Passed as a single argument, never through a shell.' },
    paths: { type: 'array', items: { type: 'string' }, description: 'Stage only these paths before committing.' },
    all: { type: 'boolean', description: 'Stage every change (git add -A) before committing.' },
    amend: { type: 'boolean', description: 'Amend the previous commit instead of creating a new one.' },
    signoff: { type: 'boolean', description: 'Add a Signed-off-by trailer.' },
  },
  output: {
    schema: { type: 'json' },
    render: function (_args, value) {
      if (value.ok === true) return [{ type: 'text', text: 'committed ' + String(value.hash) + (value.amended === true ? ' (amended)' : '') + '\n' + String(value.stdout).replace(/\n+$/, '') }]
      return [{ type: 'text', text: renderOutcome(value, 'git commit') }]
    },
  },
  isConcurrencySafe: function () { return false },
  execute: async function (args, exec) {
    const paths = Array.isArray(args.paths) ? args.paths.filter(isStr) : []
    if (args.all === true) {
      const staged = await git(args, ['add', '-A'], exec, {})
      if (staged.exitCode !== 0) return { ok: false, cwd: staged.cwd, exitCode: staged.exitCode, stdout: staged.stdout, stderr: staged.stderr, error: 'stage-failed' }
    } else if (paths.length > 0) {
      const staged = await git(args, ['add', '--'].concat(paths), exec, {})
      if (staged.exitCode !== 0) return { ok: false, cwd: staged.cwd, exitCode: staged.exitCode, stdout: staged.stdout, stderr: staged.stderr, error: 'stage-failed' }
    }
    const argv = ['commit', '-m', args.message]
    if (args.amend === true) argv.push('--amend')
    if (args.signoff === true) argv.push('--signoff')
    const committed = await git(args, argv, exec, {})
    if (committed.exitCode !== 0) {
      return { ok: false, cwd: committed.cwd, exitCode: committed.exitCode, stdout: committed.stdout, stderr: committed.stderr, error: 'commit-failed' }
    }
    const rev = await git(args, ['rev-parse', '--short', 'HEAD'], exec, {})
    return {
      ok: true, cwd: committed.cwd, exitCode: committed.exitCode, amended: args.amend === true,
      hash: rev.exitCode === 0 ? rev.stdout.trim() : null,
      message: args.message, stdout: committed.stdout, stderr: committed.stderr,
    }
  },
})

define('git_branch', {
  description: 'List, create, switch, delete or rename branches. "list" reports local branches with their upstream, head commit and subject; force-deleting needs confirm: true.',
  parameters: {
    repo: { type: 'string', description: 'Repository directory. Defaults to the session working directory.' },
    action: { type: 'string', required: true, enum: ['list', 'create', 'switch', 'delete', 'rename'], description: 'Operation to perform.' },
    name: { type: 'string', description: 'Branch name. Required for every action except "list". For "rename" it is the NEW name of the current branch.' },
    startPoint: { type: 'string', description: 'For "create", the start point; for "switch", creates the branch there first.' },
    all: { type: 'boolean', description: 'For "list", include remote-tracking branches.' },
    force: { type: 'boolean', description: 'For "delete", delete even when unmerged (git branch -D). Needs confirm: true.' },
    confirm: { type: 'boolean', description: 'Must be true when force is used.' },
  },
  output: {
    schema: { type: 'json' },
    render: function (_args, value) {
      if (value.action === 'list') return [{ type: 'text', text: renderBranches(value) }]
      return [{ type: 'text', text: renderOutcome(value, 'git branch ' + String(value.action)) }]
    },
  },
  isConcurrencySafe: function () { return false },
  execute: async function (args, exec) {
    const action = args.action
    const name = isStr(args.name) && args.name.trim().length > 0 ? args.name.trim() : null
    if (action !== 'list' && name === null) {
      return { ok: false, action: action, cwd: here(args, exec), error: 'name is required for action ' + action }
    }
    if (action === 'delete' && args.force === true && args.confirm !== true) {
      return { ok: false, action: action, cwd: here(args, exec), blocked: 'confirmation-required', reason: 'force-deleting a branch discards commits that are not merged anywhere else' }
    }

    if (action === 'list') {
      const argv = ['-c', 'core.quotePath=false', 'branch', '--format=%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(objectname:short)%1f%(contents:subject)']
      if (args.all === true) argv.push('-a')
      const listed = await git(args, argv, exec, {})
      if (listed.exitCode !== 0) {
        return { ok: false, action: 'list', cwd: listed.cwd, exitCode: listed.exitCode, stdout: listed.stdout, stderr: listed.stderr, error: 'branch-list-failed' }
      }
      const branches = []
      let current = null
      const rows = listed.stdout.split('\n')
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i]
        if (row.length === 0) continue
        const fields = row.split('\u001f')
        const isCurrent = fields[1] === '*'
        if (isCurrent) current = fields[0] === undefined ? null : fields[0]
        branches.push({
          name: fields[0] === undefined ? '' : fields[0],
          current: isCurrent,
          upstream: fields[2] === undefined ? '' : fields[2],
          head: fields[3] === undefined ? '' : fields[3],
          subject: fields[4] === undefined ? '' : fields[4],
        })
      }
      return { ok: true, action: 'list', cwd: listed.cwd, exitCode: listed.exitCode, current: current, branches: branches, stdout: listed.stdout, stderr: listed.stderr }
    }

    let argv
    if (action === 'create') {
      argv = ['branch', name]
      if (isStr(args.startPoint) && args.startPoint.trim().length > 0) argv.push(args.startPoint.trim())
    } else if (action === 'switch') {
      if (isStr(args.startPoint) && args.startPoint.trim().length > 0) argv = ['switch', '-c', name, args.startPoint.trim()]
      else argv = ['switch', name]
    } else if (action === 'delete') {
      argv = ['branch', args.force === true ? '-D' : '-d', name]
    } else {
      argv = ['branch', '-m', name]
    }
    const done = await git(args, argv, exec, {})
    done.action = action
    return done
  },
})

define('git_stash', {
  description: 'Manage the stash: list entries, push the current changes onto it, pop or apply an entry, show one, or drop/clear entries. Dropping and clearing need confirm: true.',
  parameters: {
    repo: { type: 'string', description: 'Repository directory. Defaults to the session working directory.' },
    action: { type: 'string', required: true, enum: ['list', 'push', 'pop', 'apply', 'show', 'drop', 'clear'], description: 'Operation to perform.' },
    message: { type: 'string', description: 'For "push", the stash message.' },
    index: { type: 'number', description: 'For pop/apply/show/drop, which stash entry (default 0, the most recent).' },
    paths: { type: 'array', items: { type: 'string' }, description: 'For "push", stash only these paths.' },
    confirm: { type: 'boolean', description: 'Must be true for "drop" and "clear".' },
  },
  output: {
    schema: { type: 'json' },
    render: function (_args, value) {
      if (value.action === 'list') return [{ type: 'text', text: renderStashes(value) }]
      return [{ type: 'text', text: renderOutcome(value, 'git stash ' + String(value.action)) }]
    },
  },
  isConcurrencySafe: function () { return false },
  execute: async function (args, exec) {
    const action = args.action
    const rawIndex = typeof args.index === 'number' && args.index >= 0 ? Math.floor(args.index) : 0
    const selector = 'stash@{' + String(rawIndex) + '}'

    if (action === 'clear') {
      if (args.confirm !== true) return { ok: false, action: action, cwd: here(args, exec), blocked: 'confirmation-required', reason: 'stash clear drops every stash entry permanently' }
      const done = await git(args, ['stash', 'clear'], exec, {})
      done.action = action
      return done
    }
    if (action === 'drop') {
      if (args.confirm !== true) return { ok: false, action: action, cwd: here(args, exec), blocked: 'confirmation-required', reason: 'stash drop discards a stash entry permanently' }
      const done = await git(args, ['stash', 'drop', selector], exec, {})
      done.action = action
      return done
    }
    if (action === 'list') {
      const listed = await git(args, ['stash', 'list', '--format=%gd%x1f%gs%x1f%aI'], exec, {})
      if (listed.exitCode !== 0) {
        return { ok: false, action: 'list', cwd: listed.cwd, exitCode: listed.exitCode, stdout: listed.stdout, stderr: listed.stderr, error: 'stash-list-failed', stashes: [] }
      }
      const stashes = []
      const rows = listed.stdout.split('\n')
      for (let i = 0; i < rows.length; i += 1) {
        if (rows[i].length === 0) continue
        const fields = rows[i].split('\u001f')
        stashes.push({
          ref: fields[0] === undefined ? '' : fields[0],
          subject: fields[1] === undefined ? '' : fields[1],
          date: fields[2] === undefined ? '' : (fields[2].length >= 16 ? fields[2].slice(0, 16).replace('T', ' ') : fields[2]),
        })
      }
      return { ok: true, action: 'list', cwd: listed.cwd, exitCode: listed.exitCode, stashes: stashes, stdout: listed.stdout, stderr: listed.stderr }
    }

    let argv
    if (action === 'push') {
      argv = ['stash', 'push']
      if (isStr(args.message) && args.message.length > 0) { argv.push('-m'); argv.push(args.message) }
      const paths = Array.isArray(args.paths) ? args.paths.filter(isStr) : []
      if (paths.length > 0) argv = argv.concat(['--']).concat(paths)
    } else {
      argv = ['stash', action, selector]
    }
    const done = await git(args, argv, exec, {})
    done.action = action
    return done
  },
})

define('git_sync', {
  description: 'Work with remotes: fetch, pull, push, list remotes, and add/remove/retarget one. A protected branch (main/master) can never be force-pushed, and any force push needs confirm: true.',
  parameters: {
    repo: { type: 'string', description: 'Repository directory. Defaults to the session working directory.' },
    action: { type: 'string', required: true, enum: ['fetch', 'pull', 'push', 'remote-list', 'remote-add', 'remote-remove', 'set-url'], description: 'Operation to perform.' },
    remote: { type: 'string', description: 'Remote name, e.g. "origin".' },
    branch: { type: 'string', description: 'Branch to pull or push.' },
    url: { type: 'string', description: 'Remote URL for remote-add and set-url.' },
    setUpstream: { type: 'boolean', description: 'For "push", set the upstream tracking branch (git push -u).' },
    prune: { type: 'boolean', description: 'For "fetch", drop remote-tracking refs that no longer exist (--prune).' },
    ff: { type: 'string', enum: ['auto', 'only', 'rebase'], description: 'For "pull": "only" passes --ff-only, "rebase" passes --rebase.' },
    force: { type: 'string', enum: ['none', 'lease', 'force'], description: 'For "push": "lease" passes --force-with-lease, "force" passes --force and needs confirm: true.' },
    confirm: { type: 'boolean', description: 'Must be true for a force push and for remote-remove.' },
  },
  output: {
    schema: { type: 'json' },
    render: function (_args, value) { return [{ type: 'text', text: renderOutcome(value, 'git ' + String(value.action)) }] },
  },
  isConcurrencySafe: function () { return false },
  execute: async function (args, exec) {
    const action = args.action
    const remote = isStr(args.remote) && args.remote.trim().length > 0 ? args.remote.trim() : null
    const branch = isStr(args.branch) && args.branch.trim().length > 0 ? args.branch.trim() : null
    const url = isStr(args.url) && args.url.trim().length > 0 ? args.url.trim() : null
    const cwd = here(args, exec)

    if (action === 'push' && args.force === 'force' && branch !== null && PROTECTED_BRANCHES.indexOf(branch) >= 0) {
      return { ok: false, action: action, cwd: cwd, blocked: 'forbidden', reason: 'force-pushing to a protected branch (main/master) is never allowed' }
    }
    if (action === 'push' && (args.force === 'force' || args.force === 'lease') && args.confirm !== true) {
      return { ok: false, action: action, cwd: cwd, blocked: 'confirmation-required', reason: 'a force push overwrites remote history' }
    }
    if (action === 'remote-remove' && args.confirm !== true) {
      return { ok: false, action: action, cwd: cwd, blocked: 'confirmation-required', reason: 'remote remove detaches every local branch that tracks it' }
    }
    if ((action === 'remote-add' || action === 'set-url') && (remote === null || url === null)) {
      return { ok: false, action: action, cwd: cwd, error: action + ' needs both remote and url' }
    }
    if (action === 'remote-remove' && remote === null) {
      return { ok: false, action: action, cwd: cwd, error: action + ' needs remote' }
    }

    let argv
    if (action === 'fetch') {
      argv = ['fetch']
      if (remote !== null) argv.push(remote)
      if (args.prune === true) argv.push('--prune')
    } else if (action === 'pull') {
      argv = ['pull']
      if (remote !== null) argv.push(remote)
      if (branch !== null) argv.push(branch)
      if (args.ff === 'only') argv.push('--ff-only')
      else if (args.ff === 'rebase') argv.push('--rebase')
    } else if (action === 'push') {
      argv = ['push']
      if (args.setUpstream === true) argv.push('-u')
      if (args.force === 'lease') argv.push('--force-with-lease')
      else if (args.force === 'force') argv.push('--force')
      if (remote !== null) argv.push(remote)
      if (branch !== null) argv.push(branch)
    } else if (action === 'remote-list') {
      argv = ['remote', '-v']
    } else if (action === 'remote-add') {
      argv = ['remote', 'add', remote, url]
    } else if (action === 'remote-remove') {
      argv = ['remote', 'remove', remote]
    } else {
      argv = ['remote', 'set-url', remote, url]
    }

    const done = await git(args, argv, exec, { timeoutMs: 300000 })
    done.action = action
    return done
  },
})

