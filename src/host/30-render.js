/* ─────────────── renderers ─────────────── */

function renderPassthrough(value) {
  const lines = ['$ ' + value.command]
  if (value.cwd !== null) lines.push('cwd: ' + value.cwd)
  if (value.blocked === 'forbidden') {
    lines.push('BLOCKED by git plugin policy: ' + value.reason)
    return lines.join('\n')
  }
  if (value.blocked === 'confirmation-required') {
    lines.push('CONFIRMATION REQUIRED: ' + value.reason)
    lines.push('Nothing was executed. Re-call with confirm: true only if this destructive operation is really intended.')
    return lines.join('\n')
  }
  const out = value.stdout.replace(/\n+$/, '')
  const err = value.stderr.replace(/\n+$/, '')
  if (out.length > 0) lines.push(out)
  if (err.length > 0) lines.push('[stderr]\n' + err)
  if (out.length === 0 && err.length === 0) lines.push('(no output)')
  lines.push('[exit code: ' + String(value.exitCode) + ']')
  if (value.timedOut === true) lines.push('(timed out)')
  if (value.sandboxDenied === true) lines.push('(denied by the file sandbox)')
  if (value.truncated === true) lines.push('(output truncated' + (value.spillPath !== null ? '; full output at ' + value.spillPath : '') + ')')
  return lines.join('\n')
}

function renderOutcome(value, title) {
  const lines = [title]
  if (value.cwd !== undefined && value.cwd !== null) lines.push('cwd: ' + String(value.cwd))
  if (value.blocked === 'forbidden') { lines.push('BLOCKED by git plugin policy: ' + value.reason); return lines.join('\n') }
  if (value.blocked === 'confirmation-required') {
    lines.push('CONFIRMATION REQUIRED: ' + value.reason)
    lines.push('Nothing was executed. Re-call with confirm: true only if this is really intended.')
    return lines.join('\n')
  }
  const out = isStr(value.stdout) ? value.stdout.replace(/\n+$/, '') : ''
  const err = isStr(value.stderr) ? value.stderr.replace(/\n+$/, '') : ''
  if (value.ok === true) {
    if (out.length > 0) lines.push(out)
    if (err.length > 0) lines.push('[stderr]\n' + err)
    if (out.length === 0 && err.length === 0) lines.push('ok')
    return lines.join('\n')
  }
  if (err.length > 0) lines.push(err)
  if (out.length > 0) lines.push(out)
  lines.push('[exit code: ' + String(value.exitCode) + ']')
  return lines.join('\n')
}

const STATUS_LABELS = {
  M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied',
  T: 'typechange', U: 'unmerged', '.': 'unchanged',
}

function statusLabel(code) {
  return STATUS_LABELS[code] === undefined ? code : STATUS_LABELS[code]
}

function parseStatusV2(stdout) {
  const parsed = {
    branch: null, detached: false, upstream: null, ahead: 0, behind: 0,
    staged: [], unstaged: [], untracked: [], unmerged: [],
  }
  const lines = stdout.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.length === 0) continue
    if (line.charAt(0) === '#') {
      const head = line.slice(2)
      const space = head.indexOf(' ')
      const key = space < 0 ? head : head.slice(0, space)
      const rest = space < 0 ? '' : head.slice(space + 1)
      if (key === 'branch.head') {
        if (rest === '(detached)') parsed.detached = true
        else parsed.branch = rest
      } else if (key === 'branch.upstream') {
        parsed.upstream = rest
      } else if (key === 'branch.ab') {
        const parts = rest.split(' ')
        if (parts.length === 2) {
          parsed.ahead = parseInt(parts[0].slice(1), 10) || 0
          parsed.behind = parseInt(parts[1].slice(1), 10) || 0
        }
      }
      continue
    }
    const marker = line.charAt(0)
    if (marker === '?') { parsed.untracked.push(line.slice(2)); continue }
    if (marker === '!') continue
    if (marker === '1' || marker === '2' || marker === 'u') {
      const fields = line.split(' ')
      const xy = fields[1] === undefined ? '..' : fields[1]
      let path = ''
      if (marker === '1') path = fields.slice(8).join(' ')
      else if (marker === '2') path = fields.slice(9).join(' ').split('\t')[0]
      else path = fields.slice(10).join(' ')
      const entry = { path: path, code: xy, label: statusLabel(xy.charAt(0)) + '/' + statusLabel(xy.charAt(1)) }
      if (marker === 'u') { parsed.unmerged.push(entry); continue }
      if (xy.charAt(0) !== '.') parsed.staged.push(entry)
      if (xy.charAt(1) !== '.') parsed.unstaged.push(entry)
    }
  }
  return parsed
}

function renderStatus(value) {
  if (value.ok !== true) {
    return 'git status failed in ' + String(value.cwd) + '\n' + value.stderr.replace(/\n+$/, '') + '\n[exit code: ' + String(value.exitCode) + ']'
  }
  const lines = []
  lines.push('repo:      ' + String(value.cwd))
  const head = value.detached === true ? '(detached HEAD)' : String(value.branch)
  const track = value.upstream === null ? '' : ' -> ' + value.upstream + '  ahead ' + String(value.ahead) + ', behind ' + String(value.behind)
  lines.push('branch:    ' + head + track)
  if (value.unmerged.length > 0) {
    lines.push('conflicts: ' + String(value.unmerged.length))
    for (let i = 0; i < value.unmerged.length; i += 1) lines.push('  ' + value.unmerged[i].code + '  ' + value.unmerged[i].path)
  }
  lines.push('staged:    ' + String(value.staged.length))
  for (let i = 0; i < value.staged.length; i += 1) lines.push('  ' + value.staged[i].code + '  ' + value.staged[i].path)
  lines.push('unstaged:  ' + String(value.unstaged.length))
  for (let i = 0; i < value.unstaged.length; i += 1) lines.push('  ' + value.unstaged[i].code + '  ' + value.unstaged[i].path)
  lines.push('untracked: ' + String(value.untracked.length))
  for (let i = 0; i < value.untracked.length; i += 1) lines.push('  ??  ' + value.untracked[i])
  if (value.clean === true) lines.push('working tree clean')
  return lines.join('\n')
}

function renderLog(value) {
  if (value.ok !== true) {
    return 'git log failed in ' + String(value.cwd) + '\n' + value.stderr.replace(/\n+$/, '') + '\n[exit code: ' + String(value.exitCode) + ']'
  }
  if (value.commits.length === 0) return 'no commits matched in ' + String(value.cwd)
  const lines = []
  for (let i = 0; i < value.commits.length; i += 1) {
    const entry = value.commits[i]
    const refs = entry.refs.length > 0 ? '  (' + entry.refs + ')' : ''
    lines.push(entry.short + '  ' + entry.date + '  ' + entry.author + '  ' + entry.subject + refs)
  }
  return lines.join('\n')
}

function renderDiff(value) {
  if (value.ok !== true) {
    return 'git diff failed in ' + String(value.cwd) + '\n' + value.stderr.replace(/\n+$/, '') + '\n[exit code: ' + String(value.exitCode) + ']'
  }
  const lines = ['diff mode: ' + value.mode, 'cwd: ' + String(value.cwd), 'changed files: ' + String(value.paths.length)]
  for (let i = 0; i < value.paths.length; i += 1) lines.push('  ' + value.paths[i])
  if (value.note !== null) lines.push('note: ' + value.note)
  if (value.cardAvailable === true) lines.push('(a native diff card is attached to this call)')
  if (value.truncated === true) lines.push('(some file content was truncated in the card)')
  if (value.patch !== null) { lines.push(''); lines.push(value.patch.replace(/\n+$/, '')) }
  return lines.join('\n')
}

function renderBranches(value) {
  if (value.ok !== true) return renderOutcome(value, 'git branch')
  const lines = ['current: ' + (value.current === null ? '(detached or unknown)' : value.current)]
  for (let i = 0; i < value.branches.length; i += 1) {
    const entry = value.branches[i]
    const track = entry.upstream.length > 0 ? ' -> ' + entry.upstream : ''
    lines.push((entry.current ? '* ' : '  ') + entry.name + track + (entry.subject.length > 0 ? '  ' + entry.subject : ''))
  }
  return lines.join('\n')
}

function renderStashes(value) {
  if (value.ok !== true) return renderOutcome(value, 'git stash')
  if (value.stashes.length === 0) return 'no stash entries'
  const lines = []
  for (let i = 0; i < value.stashes.length; i += 1) {
    const entry = value.stashes[i]
    lines.push(entry.ref + '  ' + entry.date + '  ' + entry.subject)
  }
  return lines.join('\n')
}

/* ─────────────── diff helpers ─────────────── */

function parseNulList(stdout) {
  const parts = stdout.split('\u0000')
  const out = []
  for (let i = 0; i < parts.length; i += 1) if (parts[i].length > 0) out.push(parts[i])
  return out
}

function capText(text) {
  const lines = text.split('\n')
  if (lines.length > 4000) return { text: lines.slice(0, 4000).join('\n'), cut: true }
  if (text.length > 300000) return { text: text.slice(0, 300000), cut: true }
  return { text: text, cut: false }
}

async function readBlob(args, spec, exec) {
  const result = await git(args, ['show', spec], exec, { maxBytes: 400000 })
  if (result.exitCode !== 0) return null
  return result.stdout
}

async function readWorktreeFile(args, path, exec) {
  const result = await invoke('cat ' + shq(path), args, exec, { maxBytes: 400000 })
  if (result.exitCode !== 0) return null
  return result.stdout
}

const CARD_TOTAL_LIMIT = 500000

