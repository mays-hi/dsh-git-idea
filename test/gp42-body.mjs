/* ═══ gp42：一个文件的差异 ═══
   面板能说「哪个文件改了」很久了：变更树、提交下的文件列表都是这样。但两处的行
   都到那里为止 —— 没有一次读取返回过 patch，所以一个文件可以被报告成「改了」，却
   永远看不到「改成什么样」。这个套件盯的就是补上的那一块：

   1. 两个列表里的文件行点开就是差异；返回键回到列表
   2. 一个文件同时有已暂存和未暂存两段时，两次读取分别落在两个小节里
   3. 行号来自 @@ 的计数，删除行只出现在旧文件一侧
   4. 未跟踪的二进制文件不当作文本显示；只有一次读取
   5. 提交下的文件读的是那次提交（重命名的旧路径一起带上）
   6. 勾选框在固定的一列；git 折叠掉的未跟踪目录也有行
   7. 点一下勾选框：立刻画出来，不会被迟到的读抹掉
   8. 树行的手势：单击只选中，双击或点三角才展开
   9. 展开未跟踪目录的那一瞬间：读还没回来时列表是 undefined，不能崩
   10. 两个分组（默认变更列表 / 未跟踪的文件）和两个视图（树 / 扁平） */

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
const untrackedCalls = []
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
      untracked: ['tmp.bin', 'newdir/'],
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
  if (method === 'git/untracked') {
    untrackedCalls.push(args)
    return Promise.resolve({ ok: true, dir: args.dir, files: ['newdir/a.txt', 'newdir/deep/b.txt'], truncated: false })
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
ok('变更页签上带着未提交文件数（否则它只是个没有内容暗示的页签）', textOf(changesTab) === '变更4')
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

/* ── 一条源码规矩 ──
   差异的「身份」必须把路径算进去。同一个提交里的两个文件，请求的形状（模式、ref）
   完全一样：少了路径，视图会把上一个文件的 patch 留在新文件的名字下面 —— 那是
   最坏的一种错，因为它看起来是对的。现在从列表进差异必然先卸载再挂载，所以这条
   还是预防性的；将来要是把列表和差异摆在一起，它就是承重的。 */
const sourceText = fs.readFileSync(process.env.GP_SRC || new URL('../client.js', import.meta.url).pathname, 'utf8')
const shapeSource = sourceText.slice(sourceText.indexOf('function diffShape'), sourceText.indexOf('function hunkHeader'))
console.log('')
console.log('== 源码规矩 ==')
ok('差异的身份里带着路径与重命名的旧路径',
  shapeSource.indexOf('text(target.path)') >= 0 && shapeSource.indexOf('text(target.from)') >= 0)
ok('那两行确实进了依赖表（shape 在 useEffect 的依赖里）',
  sourceText.indexOf('[shape, props.repo, props.sessionId, props.sig]') >= 0)

/* ── 6. 勾选框那一列，和被折叠的未跟踪目录 ──
   截图量出来的两件事：每个目录层级把勾选框往右推一格（深度 5 的时候框已经在
   60px 处），所以一列框永远对不齐；而 git 折叠掉的未跟踪目录（路径以 / 结尾）
   在树里根本没有行 —— 变更页签说 12 个，树里只数得出 10 个，那两个目录里的文件
   既看不见也暂存不了。 */

console.log('')
console.log('== 勾选框那一列 ==')
/* 上一节停在历史页的提交差异里：先退出来，再回到变更页 */
toolByTitle(tree, '返回文件列表').props.onClick()
await wait(10)
tree = await settle()
buttons(tree).find(function (b) { return textOf(b).indexOf('变更') >= 0 }).props.onClick()
await wait(10)
tree = await settle()

/* 分组标题（默认变更列表 / 未跟踪的文件）是树里的一行，但它不是文件：它没有勾选框，
   所以「每个文件行的第一个孩子都是勾选框」这条把它排除在外，另有一条专门说它。 */
const groupRows = byClass(tree, 'dsh-git-cgroup')
const listRows = byClass(tree, 'dsh-git-trow').filter(function (r) {
  const cls = String(r.props.className)
  return cls.indexOf('dsh-git-trow-head') < 0 && cls.indexOf('dsh-git-cgroup') < 0
})
ok('每一行的第一个孩子都是勾选框（框在最左边一列）',
  listRows.length >= 4 && listRows.every(function (r) {
    const kids = r.props.children || []
    return kids.length > 0 && String(kids[0].props.className).indexOf('dsh-git-cbox') >= 0
  }))
ok('分组标题自己在，而且没有勾选框（它不是文件）',
  groupRows.length === 2 && groupRows.every(function (r) {
    return byClass(r, 'dsh-git-cbox').length === 0 && byClass(r, 'dsh-git-tw').length === 1
  }))
ok('行自己不再带缩进（缩进是行内的空块，所以框不会被推着走）',
  listRows.every(function (r) { return r.props.style === undefined || r.props.style.paddingLeft === undefined }))
const padOf = function (row) {
  const pad = byClass(row, 'dsh-git-tind')[0]
  return pad === undefined ? null : pad.props.style.width
}
ok('顶层行的缩进块宽度是 0', padOf(changeRow(tree, 'notes.md')) === '0px')
ok('下一层是 12px（缩进仍然逐层加宽，只是不再动勾选框）',
  padOf(changeRow(tree, 'app.js')) === '12px')

console.log('')
console.log('== 被折叠的未跟踪目录 ==')
const dirRow = changeRow(tree, 'newdir/')
ok('git 折叠掉的目录照样有一行（以前它被整行丢掉）', dirRow !== undefined)
ok('这一行说得出自己是目录', byClass(dirRow, 'dsh-git-tdir').length === 1)
ok('它也有展开的三角', byClass(dirRow, 'dsh-git-tw').length === 1)
ok('它的缩进块和同层文件一样是 0', padOf(dirRow) === '0px')

byClass(dirRow, 'dsh-git-tw')[0].props.onClick({ stopPropagation: function () {} })
await wait(10)
tree = await settle()
ok('展开时才去读一次目录里的文件', untrackedCalls.length === 1 && untrackedCalls[0].dir === 'newdir/')
ok('读的是这个会话的那次请求', untrackedCalls[0].sessionId === 's-1')

const insideRow = changeRow(tree, 'a.txt')
ok('目录里的文件成为子行', insideRow !== undefined)
ok('子行按名字显示（相对目录的路径）', textOf(insideRow).indexOf('newdir') < 0)
ok('子行缩进一层', padOf(insideRow) === '12px')
ok('子行也是勾选框在最左', String((insideRow.props.children || [])[0].props.className).indexOf('dsh-git-cbox') >= 0)

const beforeChildDiff = diffCalls.length
insideRow.props.onClick()
await wait(10)
tree = await settle()
const childAsk = diffCalls[diffCalls.length - 1]
ok('点开目录里的文件就是它的差异', diffCalls.length - beforeChildDiff === 1
  && childAsk.mode === 'untracked' && childAsk.path === 'newdir/a.txt')

toolByTitle(tree, '返回文件列表').props.onClick()
await wait(10)
tree = await settle()
const deepRow = changeRow(tree, 'deep/b.txt')
ok('多层子路径也照常显示', deepRow !== undefined)
const beforeChildStage = calls.length
byClass(deepRow, 'dsh-git-cbox')[0].props.onClick({ stopPropagation: function () {} })
await wait(10)
tree = await settle()
ok('子行的勾选框暂存的是那个文件本身',
  calls.some(function (c) { return c.method === 'git/stage' && c.args.paths[0] === 'newdir/deep/b.txt' }))

const beforeDirStage = calls.length
const dirAgain = changeRow(tree, 'newdir/')
byClass(dirAgain, 'dsh-git-cbox')[0].props.onClick({ stopPropagation: function () {} })
await wait(10)
await settle()
ok('目录那一行的勾选框暂存整个目录（git add -- dir 不需要先列出内容）',
  calls.some(function (c) { return c.method === 'git/stage' && c.args.paths[0] === 'newdir/' }))

/* ── 7. 点一下勾选框：立刻有反应，而且不会被迟到的读抹掉 ──

   在读者那台机器上量过：`git add` 是 98–236ms，而面板原来要等一次整棵树的
   `git status` 才把框画出来 —— 那里是 7.4s（冷的时候 13.6s）。点一下等七秒，
   和点一下没反应是同一件事，所以框现在从点击本身画出来，随后的读只确认它。
   下面盯的就是这条链的四件事：立刻画、只问这些路径、失败就还原、旧读不许翻盘。 */

console.log('')
console.log('== 点一下勾选框 ==')

const savedCall = host.call
const glyphOf = function (row) {
  const box = row === undefined ? undefined : byClass(row, 'dsh-git-cbox')[0]
  return box === undefined ? null : textOf(box)
}
const stagedLine = function (tree) {
  const line = collect(tree).filter(function (n) { return String(textOf(n)).indexOf('已暂存 ') >= 0 })[0]
  return line === undefined ? '' : textOf(line)
}
const clickBox = async function (label) {
  const row = changeRow(tree, label)
  byClass(row, 'dsh-git-cbox')[0].props.onClick({ stopPropagation: function () {} })
  await wait(10)
  return await settle()
}

/* 7a. git 还没回话，框就得动 */
const beforeTick = changeRow(tree, 'notes.md')
ok('点之前 notes.md 是没暂存的空框', glyphOf(beforeTick) === '☐' && stagedLine(tree).indexOf('已暂存 1 ') >= 0)
let releaseStage = null
host.call = function (method, args) {
  if (method === 'git/stage') {
    calls.push({ method: method, args: args })
    return new Promise(function (resolve) { releaseStage = resolve })
  }
  return savedCall(method, args)
}
const tickCalls = calls.length
tree = await clickBox('notes.md')
ok('git 还没回话，框就已经是已暂存（不再等那一次整树读）', glyphOf(changeRow(tree, 'notes.md')) === '☑')
ok('「已暂存 N」跟着动（还是没等 git）', stagedLine(tree).indexOf('已暂存 2 ') >= 0)
ok('这一下确实发出去了', calls.length > tickCalls
  && calls.some(function (c) { return c.method === 'git/stage' && c.args.paths[0] === 'notes.md' }))

/* 7b. 确认读只问这些路径 —— 整棵树 7.4s，这些路径 0.5s */
const targetReads = function () {
  return calls.filter(function (c) {
    return c.method === 'git/panel' && c.args.quick !== true && Array.isArray(c.args.paths)
  })
}
if (releaseStage !== null) releaseStage({ ok: true, repo: '/tmp/ws', stdout: '', stderr: '', exitCode: 0 })
host.call = savedCall
tree = await settle()
const confirmAsk = targetReads()[targetReads().length - 1]
ok('确认读按路径问（不是整棵树）', confirmAsk !== undefined && confirmAsk.args.paths.length === 1
  && confirmAsk.args.paths[0] === 'notes.md')
ok('确认读仍带着这个会话', confirmAsk.args.sessionId === 's-1' && confirmAsk.args.repo === undefined)

/* 7c. 一次正在飞的整树读，不许把刚点的框擦回去 */
let releaseFull = null
host.call = function (method, args) {
  if (method === 'git/panel' && args != null && args.quick !== true) {
    calls.push({ method: method, args: args })
    if (Array.isArray(args.paths)) {
      /* 这一节里 mock 照刚才那次点击回答，这样确认读真的是「确认」 */
      return Promise.resolve({
        ok: true, partial: true, paths: args.paths, repo: '/tmp/ws', branch: 'main', detached: false,
        upstream: '', ahead: 0, behind: 0, sequencer: null,
        staged: [{ path: 'notes.md', code: 'M' }], unstaged: [], untracked: [], unmerged: [],
      })
    }
    return new Promise(function (resolve) { releaseFull = resolve })
  }
  return savedCall(method, args)
}
toolByTitle(tree, '重新读取仓库（忽略缓存）').props.onClick()
await wait(10)
tree = await settle()
ok('刷新键发出的是一次整树读，它还没回来', releaseFull !== null)
tree = await clickBox('notes.md')
ok('在读还没回来的时候点：框照样立刻是已暂存', glyphOf(changeRow(tree, 'notes.md')) === '☑')
if (releaseFull !== null) {
  /* 这份回答描述的是点击之前的工作区：它要是画上去，刚点的那一下就没了 */
  releaseFull({
    ok: true, repo: '/tmp/ws', branch: 'main', detached: false, upstream: '', ahead: 0, behind: 0, sequencer: null,
    staged: [], unstaged: [{ path: 'notes.md', code: 'M' }, { path: 'stale.txt', code: 'M' }], untracked: [], unmerged: [],
  })
}
host.call = savedCall
tree = await settle()
ok('迟到的旧读被丢掉，框还在（这就是「点一下又丢失」的那个 bug）', glyphOf(changeRow(tree, 'notes.md')) === '☑')
ok('旧读里的别的改动也没被画上去', changeRow(tree, 'stale.txt') === undefined)

/* 7d. git 拒绝的时候：还原，并且说清楚 */
const failBefore = host.call
host.call = function (method, args) {
  if (method === 'git/stage') {
    calls.push({ method: method, args: args })
    return Promise.resolve({ ok: false, repo: '/tmp/ws', stdout: '', stderr: 'fatal: pathspec did not match', exitCode: 1, command: 'git add -- tmp.bin' })
  }
  return failBefore(method, args)
}
tree = await clickBox('tmp.bin')
ok('git 拒绝了：框退回原样', glyphOf(changeRow(tree, 'tmp.bin')) === '☐')
ok('并且把 git 的话显示出来', byClass(tree, 'dsh-git-error').length > 0 && textOf(tree).indexOf('pathspec did not match') >= 0)
host.call = failBefore
await settle()

/* ── 8. 树行的手势：单击只选中，双击或点三角才展开 ──

   这是 IDEA 的项目树手势，也是读者点名要的那一条：行的第一次点击只是把这一行选中，
   树的形状一点不动；展开/折叠要么双击整行，要么点它左边那个三角。

   对它较真的是未跟踪目录：展开它要读一次目录内容（一次读取），而单击不该顺手把它
   带走 —— 单击就展开的话，想「只选中这一行」的人每次都要多一次目录读。这一节把
   手势逐条钉住，顺带钉住唯一不在这条规矩上的那种行：文件行仍然是单击就看差异，
   那是 IDEA 提交窗口自己的手势（竖着排的列表旁边就是差异，选中即预览）。 */

console.log('')
console.log('== 单击只选中，双击或三角才展开 ==')

const selectedRows = function (t) {
  return byClass(t, 'dsh-git-trow').filter(function (r) {
    return String(r.props.className).split(' ').indexOf('dsh-git-trow-sel') >= 0
  })
}
const isSelected = function (t, label) {
  const row = changeRow(t, label)
  return row !== undefined && String(row.props.className).split(' ').indexOf('dsh-git-trow-sel') >= 0
}
/* 未跟踪目录的展开是一次 git/untracked；这一节数的就是它 */
const dirReads = function () { return untrackedCalls.length }

/* 8a. 已跟踪的目录行：单击只是选中 */
const srcRow = changeRow(tree, 'src')
ok('目录行有它自己的三角（展开是这一个控件的事）',
  srcRow !== undefined && byClass(srcRow, 'dsh-git-tw').length === 1)
const beforeDirClick = calls.length
srcRow.props.onClick()
await wait(10)
tree = await settle()
ok('单击目录行：子行还在（树没有动）', changeRow(tree, 'app.js') !== undefined)
ok('单击目录行：没有发出任何读取', calls.length === beforeDirClick)
ok('单击目录行：这一行变成选中', isSelected(tree, 'src') && selectedRows(tree).length === 1)

/* 8b. 双击同一个目录行：这才收起来 */
/* 手势要是退回「单击就展开」，这一节该报一排 ✗ 而不是抛栈：抛出去会把后面
   所有段落一起带走。 */
const srcAgain = changeRow(tree, 'src')
if (typeof srcAgain.props.onDoubleClick === 'function') srcAgain.props.onDoubleClick()
await wait(10)
tree = await settle()
ok('双击目录行：子行收起来了', changeRow(tree, 'app.js') === undefined)
ok('双击也只是折叠，没有触发别的读取', calls.length === beforeDirClick)
ok('双击之后选中的还是这一行', isSelected(tree, 'src'))

/* 8c. 三角：展开它，并且不把选中改到别的行上去 */
let twistyStopped = false
byClass(changeRow(tree, 'src'), 'dsh-git-tw')[0].props.onClick({ stopPropagation: function () { twistyStopped = true } })
await wait(10)
tree = await settle()
ok('点三角会拦住冒泡（所以它顺手改不了选中）', twistyStopped)
ok('点三角：子行回来了', changeRow(tree, 'app.js') !== undefined)
ok('点三角：选中的还是原来那一行', isSelected(tree, 'src') && selectedRows(tree).length === 1)

/* 8d. 未跟踪目录：先收起来（它是第 6 节展开的） */
const newdirRow = function (t) { return changeRow(t, 'newdir/') }
ok('未跟踪目录行还在（子行也还在）', newdirRow(tree) !== undefined && changeRow(tree, 'a.txt') !== undefined)
const beforeCollapse = dirReads()
byClass(newdirRow(tree), 'dsh-git-tw')[0].props.onClick({ stopPropagation: function () {} })
await wait(10)
tree = await settle()
ok('收起未跟踪目录：不读任何东西（列表只是藏起来）', dirReads() === beforeCollapse)
ok('收起之后子行不见了', changeRow(tree, 'a.txt') === undefined)

/* 8e. 折叠着的未跟踪目录上单击：只选中 */
const beforeSingle = calls.length
newdirRow(tree).props.onClick()
await wait(10)
tree = await settle()
ok('单击未跟踪目录：只选中，没有去读目录里的文件',
  isSelected(tree, 'newdir/') && dirReads() === beforeCollapse && calls.length === beforeSingle)
ok('单击未跟踪目录：树还是折着的', changeRow(tree, 'a.txt') === undefined)

/* 8f. 双击（真实的双击会先来两次单击，再来 onDoubleClick）：只读一次 */
const beforeDouble = dirReads()
const doubleRow = newdirRow(tree)
doubleRow.props.onClick()
doubleRow.props.onClick()
if (typeof doubleRow.props.onDoubleClick === 'function') doubleRow.props.onDoubleClick()
await wait(10)
tree = await settle()
ok('双击未跟踪目录：这才读一次目录内容', dirReads() - beforeDouble === 1)
ok('双击未跟踪目录：文件列出来了', changeRow(tree, 'a.txt') !== undefined && changeRow(tree, 'deep/b.txt') !== undefined)

/* 8g. 再展开一次会重新读：暂存/提交之后那份列表就是会变的东西 */
byClass(newdirRow(tree), 'dsh-git-tw')[0].props.onClick({ stopPropagation: function () {} })
await wait(10)
tree = await settle()
const beforeReopen = dirReads()
byClass(newdirRow(tree), 'dsh-git-tw')[0].props.onClick({ stopPropagation: function () {} })
await wait(10)
tree = await settle()
ok('再展开一次重新读一次（不拿上一次的旧列表凑数）', dirReads() - beforeReopen === 1)

/* 8h. 唯一不在这条规矩上的行：文件行的单击就是「看差异」 */
const beforeFileClick = diffCalls.length
changeRow(tree, 'notes.md').props.onClick()
await wait(10)
tree = await settle()
ok('文件行仍是「单击就看差异」（提交窗口里选中即预览的那个手势）',
  diffCalls.length - beforeFileClick === 1 && diffCalls[diffCalls.length - 1].path === 'notes.md')
toolByTitle(tree, '返回文件列表').props.onClick()
await wait(10)
tree = await settle()
ok('返回后还是那棵树，目录的展开状态也还在',
  changeRow(tree, 'app.js') !== undefined && changeRow(tree, 'a.txt') !== undefined)

/* ── 9. 展开未跟踪目录的那一瞬间：读还在飞的时候，列表是 undefined ──

   真实的面板在这里崩过一次，整块面板因此从 slot 上掉下来：

     Cannot read properties of undefined (reading 'length')
     at ChangesPane

   原因是一秒钟的窗口：单击展开 → `untrackedFiles[dir]` 立刻被清掉（好让行说
   「正在读取…」）→ 读回来之前它是 **undefined**。代码先把「正在读取…」画上
   去，然后**照旧**去跑 `for (k < list.length)` —— 那就是 undefined.length。

   为什么以前没发现：测试里的 mock 是立刻回答的，`await wait(10)` 之后列表早就
   在了，这一帧从来没被渲染过。**mock 越快，越看不见这条缝。** 所以这一节把
   `git/untracked` 扣住不回答，专门渲染那一帧。 */

console.log('')
console.log('== 展开未跟踪目录，读还没回来 ==')

const beforeHeld = host.call
let releaseHeld = null
host.call = function (method, args) {
  if (method === 'git/untracked') {
    untrackedCalls.push(args)
    return new Promise(function (resolve) { releaseHeld = resolve })
  }
  return beforeHeld(method, args)
}
/* 先收起来，才能再展开一次（展开的那一下就是这一节的被测对象） */
byClass(newdirRow(tree), 'dsh-git-tw')[0].props.onClick({ stopPropagation: function () {} })
await wait(10)
tree = await settle()
byClass(newdirRow(tree), 'dsh-git-tw')[0].props.onClick({ stopPropagation: function () {} })
await wait(10)
let paneCrash = null
try {
  tree = await settle()
} catch (error) {
  paneCrash = error
}
ok('读还在飞的时候渲染这一棵树不会抛异常'
  + (paneCrash === null ? '' : '：' + String(paneCrash && paneCrash.message)),
  paneCrash === null)
ok('这一帧里那一行说的是「正在读取…」',
  paneCrash === null && tree !== null && textOf(tree).indexOf('正在读取') >= 0)
if (releaseHeld !== null) {
  releaseHeld({ ok: true, dir: 'newdir/', files: ['newdir/a.txt', 'newdir/deep/b.txt'], truncated: false })
}
host.call = beforeHeld
let afterCrash = null
try {
  tree = await settle()
} catch (error) {
  afterCrash = error
}
ok('读回来之后文件行照常出现（那一帧只是中间态，不是终点）',
  afterCrash === null && changeRow(tree, 'a.txt') !== undefined && changeRow(tree, 'deep/b.txt') !== undefined)

/* ── 10. 两个分组，两个视图 ──

   IDEA 的提交窗不是一个「git 看到的东西」的大列表：它有一个变更列表（git 管着的
   改动），下面另起一个 **Unversioned Files** 节点（git 还没见过的路径）。以前这个
   面板把两者混在一棵树里 —— 未跟踪的目录就夹在被跟踪的目录中间，唯一能分辨的办法
   是去读每一行的状态字母。

   另一条轴是 IDEA 的另一个开关：按目录折叠的树，还是每个文件一行的扁平列表。同一批
   行、同样的框、同样的手势，差别只在标签和缩进（扁平视图按路径排序）。 */

console.log('')
console.log('== 两组：默认变更列表 / 未跟踪的文件 ==')

const groupTitleRow = function (t, label) {
  return byClass(t, 'dsh-git-cgroup').filter(function (r) { return textOf(r).indexOf(label) >= 0 })[0]
}
/* 每个文件行属于哪一组：按行序走，遇到分组标题就换组 */
const membersOf = function (t, label) {
  const rows = byClass(t, 'dsh-git-trow')
  const out = []
  let current = ''
  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i].props.className).indexOf('dsh-git-cgroup') >= 0) { current = textOf(rows[i]); continue }
    if (current.indexOf(label) >= 0) out.push(textOf(rows[i]))
  }
  return out
}
const trackedDirRow = function (t) {
  return byClass(t, 'dsh-git-trow').filter(function (r) {
    return textOf(r).indexOf('个文件') >= 0 && String(r.props.className).indexOf('dsh-git-cgroup') < 0
  })[0]
}

const groupTitles = byClass(tree, 'dsh-git-cgroup').map(function (r) { return textOf(r) })
ok('两个分组都在，各带自己的条数（变更 2 / 未跟踪 2）', groupTitles.length === 2
  && groupTitles[0].indexOf('默认变更列表') >= 0 && groupTitles[0].indexOf('2') >= 0
  && groupTitles[1].indexOf('未跟踪的文件') >= 0 && groupTitles[1].indexOf('2') >= 0)
ok('变更列表排在未跟踪的文件前面（IDEA 的顺序）', groupTitles.length === 2
  && groupTitles[0].indexOf('默认变更列表') >= 0 && groupTitles[1].indexOf('未跟踪的文件') >= 0)

const inTracked = membersOf(tree, '默认变更列表')
const inUnversioned = membersOf(tree, '未跟踪的文件')
ok('未跟踪的目录和未跟踪的文件都落在未跟踪这一组',
  inUnversioned.some(function (x) { return x.indexOf('newdir/') >= 0 })
  && inUnversioned.some(function (x) { return x.indexOf('tmp.bin') >= 0 }))
ok('被跟踪的文件一个都不在未跟踪组里（以前它们混在一棵树里）',
  inUnversioned.every(function (x) { return x.indexOf('app.js') < 0 && x.indexOf('notes.md') < 0 }))
ok('目录树在变更列表这一组里', inTracked.some(function (x) { return x.indexOf('src') >= 0 })
  && inTracked.some(function (x) { return x.indexOf('app.js') >= 0 }))
ok('未跟踪目录里列出来的文件也算未跟踪组的（它们跟着自己的目录）',
  inUnversioned.some(function (x) { return x.indexOf('a.txt') >= 0 }))

console.log('')
console.log('== 两个视图：树 / 扁平 ==')
const viewBtn = function (t, label) {
  return buttons(t).filter(function (b) {
    return textOf(b) === label && String(b.props.className).indexOf('dsh-git-cview') >= 0
  })[0]
}
/* 这一节剩下的断言都要点控件：分组或开关要是退回去了，这里该报 ✗ 而不是抛栈 ——
   抛出去会把这一节剩下的断言一起带走，回归信号就只剩一个栈。 */
const press = function (node, name, extra) {
  if (node !== undefined && typeof node.props[name] === 'function') node.props[name](extra)
}
ok('工具条上有两个视图按钮', viewBtn(tree, '树') !== undefined && viewBtn(tree, '扁平') !== undefined)
ok('默认是树视图（src/ 带条数的那一行在）',
  trackedDirRow(tree) !== undefined && textOf(trackedDirRow(tree)).indexOf('src') >= 0)

press(viewBtn(tree, '扁平'), 'onClick')
await wait(10)
tree = await settle()
const flatTexts = byClass(tree, 'dsh-git-trow').map(function (r) { return textOf(r) })
ok('扁平视图：目录行没有了（每个文件一行）', trackedDirRow(tree) === undefined)
ok('扁平视图：文件行的名字是整条路径',
  flatTexts.some(function (x) { return x.indexOf('src/app.js') >= 0 })
  && flatTexts.some(function (x) { return x.indexOf('notes.md') >= 0 }))
ok('扁平视图：按路径排序（notes.md 在 src/app.js 前面）',
  flatTexts.findIndex(function (x) { return x.indexOf('notes.md') >= 0 })
  < flatTexts.findIndex(function (x) { return x.indexOf('src/app.js') >= 0 }))
ok('扁平视图：未跟踪目录行还在，展开的列表也给完整路径',
  changeRow(tree, 'newdir/') !== undefined
  && flatTexts.some(function (x) { return x.indexOf('newdir/a.txt') >= 0 }))
ok('扁平视图里分组照样是两组', byClass(tree, 'dsh-git-cgroup').length === 2)

const stored = JSON.parse(store['dsh.git-idea.settings'] || '{}')
ok('视图选择被记住了（写进这个浏览器的偏好）', stored.changesView === 'flat')

/* 重新挂载一遍：偏好是「记住」，不是「这一次会话里凑巧还在」 */
fibers.clear()
tree = await openPanel()
buttons(tree).find(function (b) { return textOf(b).indexOf('变更') >= 0 }).props.onClick()
await wait(10)
tree = await settle()
ok('重开面板仍然是扁平视图（偏好真的生效）',
  trackedDirRow(tree) === undefined
  && byClass(tree, 'dsh-git-trow').some(function (r) { return textOf(r).indexOf('src/app.js') >= 0 }))

press(viewBtn(tree, '树'), 'onClick')
await wait(10)
tree = await settle()
ok('切回树视图：目录行回来了', trackedDirRow(tree) !== undefined)
ok('偏好跟着改回 tree', JSON.parse(store['dsh.git-idea.settings']).changesView === 'tree')

console.log('')
console.log('== 分组标题守同一条手势 ==')
const unvTitle = groupTitleRow(tree, '未跟踪的文件')
ok('分组标题给了「双击」提示', unvTitle !== undefined && String(unvTitle.props.title).indexOf('双击') > 0)
press(unvTitle, 'onClick')
await wait(10)
tree = await settle()
ok('单击分组标题：只选中，组里的行都还在',
  changeRow(tree, 'tmp.bin') !== undefined
  && groupTitleRow(tree, '未跟踪的文件') !== undefined
  && String(groupTitleRow(tree, '未跟踪的文件').props.className).indexOf('dsh-git-trow-sel') >= 0)
press(groupTitleRow(tree, '未跟踪的文件'), 'onDoubleClick')
await wait(10)
tree = await settle()
ok('双击分组标题：这一组折起来（行不见了，标题还在）',
  changeRow(tree, 'tmp.bin') === undefined && groupTitleRow(tree, '未跟踪的文件') !== undefined)
ok('另一组不受影响（变更列表还在）', changeRow(tree, 'app.js') !== undefined)
