/* ═══ gp42：一个文件的差异 ═══
   面板能说「哪个文件改了」很久了：变更树、提交下的文件列表都是这样。但两处的行
   都到那里为止 —— 没有一次读取返回过 patch，所以一个文件可以被报告成「改了」，却
   永远看不到「改成什么样」。这个套件盯的就是补上的那一块：

   1. 两个列表里的文件行点开就是差异；返回键回到列表
   2. 一个文件同时有已暂存和未暂存两段时，两次读取分别落在两个小节里
   3. 行号来自 @@ 的计数，删除行只出现在旧文件一侧
   4. 未跟踪的二进制文件不当作文本显示；只有一次读取
   5. 提交下的文件读的是那次提交（重命名的旧路径一起带上） */

const L = function () {
  let out = ''
  for (let i = 0; i < arguments.length; i += 1) out += arguments[i] + '\n'
  return out
}

/* git 自己就是这么印的：`---`/`+++` 是文件头，不是被删掉/加上的行。 */
const PATCH_WORKTREE = L(
  'diff --git a/src/app.js b/src/app.js',
  'index 1111111..2222222 100644',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -3,3 +3,4 @@ const x = 1',
  ' line three',
  '-old line',
  '+new line',
  '+extra',
  ' tail')

const PATCH_STAGED = L(
  'diff --git a/src/app.js b/src/app.js',
  'index 0000000..1111111 100644',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -0,0 +1 @@',
  '+staged line')

const PATCH_COMMIT = L(
  'diff --git a/old.txt b/new.txt',
  'similarity index 83%',
  'rename from old.txt',
  'rename to new.txt',
  '--- a/old.txt',
  '+++ b/new.txt',
  '@@ -1,2 +1,3 @@',
  ' keep',
  '+added in commit')

const diffCalls = []
const baseCall = host.call
host.call = function (method, args) {
  if (method === 'git/panel') {
    calls.push({ method: method, args: args })
    const reply = {
      ok: true, repo: '/tmp/ws', branch: 'main', detached: false,
      upstream: 'origin/main', ahead: 0, behind: 0, sequencer: null,
    }
    if (args != null && args.quick === true) return Promise.resolve(reply)
    return Promise.resolve(Object.assign(reply, {
      staged: [{ path: 'src/app.js', code: 'M' }],
      unstaged: [{ path: 'src/app.js', code: 'M' }, { path: 'notes.md', code: 'M' }],
      untracked: ['tmp.bin'],
      unmerged: [],
    }))
  }
  if (method === 'git/commit-detail') {
    return Promise.resolve({
      ok: true, repo: '/tmp/ws', hash: (args && args.hash) || 'aaa111', subject: 'detail subject', body: '',
      author: 'mays', email: 'mays@example.com', date: '2026-09-16T10:00:00',
      files: [{ status: 'R100', path: 'new.txt', from: 'old.txt' }], branches: ['main'],
    })
  }
  if (method === 'git/diff') {
    diffCalls.push(args)
    const mode = args != null ? args.mode : ''
    if (mode === 'staged') {
      return Promise.resolve({ ok: true, mode: mode, path: args.path, text: PATCH_STAGED, added: 1, removed: 0, binary: false, truncated: false, empty: false })
    }
    if (mode === 'worktree') {
      return Promise.resolve({ ok: true, mode: mode, path: args.path, text: PATCH_WORKTREE, added: 2, removed: 1, binary: false, truncated: false, empty: false })
    }
    if (mode === 'untracked') {
      return Promise.resolve({ ok: true, mode: mode, path: args.path, text: '', added: 0, removed: 0, binary: true, truncated: false, empty: true })
    }
    if (mode === 'commit') {
      return Promise.resolve({ ok: true, mode: mode, path: args.path, text: PATCH_COMMIT, added: 1, removed: 0, binary: false, truncated: false, empty: false })
    }
    return Promise.resolve({ ok: false, error: 'unknown-mode', stderr: 'nope' })
  }
  return baseCall(method, args)
}

const changeRow = function (tree, label) {
  return byClass(tree, 'dsh-git-trow').find(function (r) { return textOf(r).indexOf(label) >= 0 })
}
const toolByTitle = function (tree, title) {
  return collect(tree).filter(function (n) { return n.type === 'button' && n.props.title === title })[0]
}
const modes = function () { return diffCalls.map(function (c) { return c.mode + '@' + c.path }) }

/* ── 1. 变更页：计数、点开、返回 ── */

let tree = await openPanel()
const changesTab = buttons(tree).find(function (b) { return textOf(b).indexOf('变更') >= 0 })
ok('变更页签上带着未提交文件数（否则它只是个没有内容暗示的页签）', textOf(changesTab) === '变更3')
changesTab.props.onClick()
await wait(10)
tree = await settle()

const appRow = changeRow(tree, 'app.js')
ok('变更列表里有 src/app.js 这一行', appRow !== undefined)
ok('文件行的提示写着可以点开', appRow !== undefined && String(appRow.props.title).indexOf('点开看差异') >= 0)

appRow.props.onClick()
await wait(10)
tree = await settle()

console.log('')
console.log('== 变更页里的一个文件 ==')
ok('一次问了两段：已暂存 + 未暂存（这个文件两段都有）',
  modes().join(' , ') === 'staged@src/app.js , worktree@src/app.js')
/* 面板没「应用」过别的路径时，请求里只有会话：仓库由 Host 从那一次会话的工作目录
   解出来，和面板其它读一样 —— 带上一个猜的路径才是错的。 */
ok('两次都带上了会话（仓库由 Host 从会话解出）',
  diffCalls.every(function (c) { return c.sessionId === 's-1' && c.repo === undefined }))
ok('表头写着路径', textOf(byClass(tree, 'dsh-git-diffpath')[0]) === 'src/app.js')
ok('表头合计 +3 −1（两段相加）', textOf(byClass(tree, 'dsh-git-diffcount')[0]).replace(/\s/g, '') === '+3−1')
const sections = byClass(tree, 'dsh-git-diffsec').map(function (n) { return textOf(n) })
ok('两段各有一个小节标题', sections.length === 2 && sections[0].indexOf('已暂存') === 0 && sections[1].indexOf('未暂存') === 0)
ok('小节标题里也带各自的数', sections[0].indexOf('+1') > 0 && sections[1].indexOf('+2') > 0)

/* @@ -3,3 +3,4 @@：上下文行占 3/3，删除行占旧 4，两个新增行占新 4、5，
   最后一行上下文占旧 5/新 6。 */
const addRows = byClass(tree, 'dsh-git-dl-add')
const delRows = byClass(tree, 'dsh-git-dl-del')
const newLine = addRows.find(function (r) { return textOf(r).indexOf('new line') >= 0 })
const newNos = newLine === undefined ? [] : byClass(newLine, 'dsh-git-dno').map(function (n) { return textOf(n) })
ok('新增行的行号落在新文件一侧', newNos.length === 2 && newNos[0] === '' && newNos[1] === '4')
const extraNos = byClass(addRows.find(function (r) { return textOf(r).indexOf('extra') >= 0 }) || {}, 'dsh-git-dno').map(function (n) { return textOf(n) })
ok('紧接着的下一个新增行是 5', extraNos[1] === '5')
const delNos = byClass(delRows.find(function (r) { return textOf(r).indexOf('old line') >= 0 }) || {}, 'dsh-git-dno').map(function (n) { return textOf(n) })
ok('删除行只出现在旧文件一侧', delNos[0] === '4' && delNos[1] === '')
ok('文件头不计进增删数（+++/--- 是头，不是行）', addRows.every(function (r) { return textOf(r).indexOf('+++') < 0 }))
ok('@@ 那一行单独成一类', byClass(tree, 'dsh-git-dl-hunk').length === 2)

/* 这个文件两段都有：差异页上的按钮说的是「取消暂存」，因为索引里已经有它了。 */
const stageBtn = buttons(tree).find(function (b) { return textOf(b) === '取消暂存' })
ok('差异页上能直接暂存这个文件', stageBtn !== undefined)
const beforeStageCalls = diffCalls.length
stageBtn.props.onClick()
await wait(10)
tree = await settle()
/* 这个文件已经在索引里了，所以按钮是「取消暂存」：点它就撤下来。 */
ok('差异页上的按钮撤下索引里的那个文件',
  calls.some(function (c) { return c.method === 'git/unstage' && c.args.paths[0] === 'src/app.js' }))
ok('暂存之后补一次工作区读', calls.filter(function (c) { return c.method === 'git/panel' && c.args.quick !== true }).length >= 2)

const back = toolByTitle(tree, '返回文件列表')
ok('返回键在', back !== undefined)
back.props.onClick()
await wait(10)
tree = await settle()
ok('返回后又是文件列表', changeRow(tree, 'app.js') !== undefined && byClass(tree, 'dsh-git-diffview').length === 0)
ok('返回没有再发读取', diffCalls.length === beforeStageCalls)

/* ── 4. 未跟踪的二进制：只读一次，不当作文本 ── */

const binCalls = diffCalls.length
changeRow(tree, 'tmp.bin').props.onClick()
await wait(10)
tree = await settle()
console.log('')
console.log('== 未跟踪的二进制 ==')
ok('只问一次（未跟踪没有 HEAD 那一侧）', diffCalls.length - binCalls === 1 && diffCalls[diffCalls.length - 1].mode === 'untracked')
ok('不当作文本渲染', byClass(tree, 'dsh-git-dline').length === 0)
ok('说清楚了是二进制', textOf(tree).indexOf('二进制') >= 0)
/* 一个 git 还没见过的文件，正是最想从这儿放进索引的那种。 */
const addBtn = buttons(tree).find(function (b) { return textOf(b) === '暂存' })
ok('未跟踪的文件在差异页上能直接暂存', addBtn !== undefined)
if (addBtn !== undefined) {
  addBtn.props.onClick()
  await wait(10)
  tree = await settle()
}
ok('走的是 git/stage', calls.some(function (c) { return c.method === 'git/stage' && c.args.paths[0] === 'tmp.bin' }))

/* ── 5. 提交下的文件：读那一次提交，重命名的旧路径一起带上 ── */

const commitCalls = diffCalls.length
toolByTitle(tree, '返回文件列表').props.onClick()
await wait(10)
tree = await settle()
buttons(tree).find(function (b) { return textOf(b).indexOf('历史') >= 0 }).props.onClick()
await wait(10)
tree = await settle()

const commitRow = byClass(tree, 'dsh-git-crow')[0]
ok('历史页有提交行', commitRow !== undefined)
commitRow.props.onClick()
await wait(10)
tree = await settle()
const commitFile = changeRow(tree, 'new.txt')
ok('提交详情里列出了文件', commitFile !== undefined)
commitFile.props.onClick()
await wait(10)
tree = await settle()

console.log('')
console.log('== 提交里的一个文件 ==')
const last = diffCalls[diffCalls.length - 1]
ok('读的是 commit 模式，ref 是这次提交', diffCalls.length - commitCalls === 1 && last.mode === 'commit' && last.ref === 'aaa111')
ok('重命名的旧路径跟着一起给 git（只给新路径的话它会报成新增）', last.from === 'old.txt')
ok('重命名那几行也显示出来', textOf(tree).indexOf('rename from old.txt') >= 0)
ok('表头还是 +1 −0', textOf(byClass(tree, 'dsh-git-diffcount')[0]).replace(/\s/g, '') === '+1−0')
ok('提交里的文件不给暂存按钮', buttons(tree).every(function (b) { return textOf(b) !== '暂存' && textOf(b) !== '取消暂存' }))

/* 刷新键：同一个文件重新读一次，请求原样 */
const beforeRefresh = diffCalls.length
toolByTitle(tree, '重新读取这个文件的差异').props.onClick()
await wait(10)
await settle()
ok('刷新键重新读一次同一个文件', diffCalls.length - beforeRefresh === 1 && diffCalls[diffCalls.length - 1].path === 'new.txt')
