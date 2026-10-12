
/* ── 工作树：只读展示（见 Host 的 67-worktrees.js 与客户端的 76-worktrees.js）──

   DSH 0.2 的模型工具 `create_worktree` 把新树建在源仓库里面的
   `.agents/worktrees/<branch>`，然后把会话的生效目录搬过去。这个插件对这件事
   不做任何写操作，只把它说清楚：

   1. 面板头上一颗"这是工作树 w1"的身份；
   2. 一个页签，列出全部工作树，点一行只切换面板看哪一棵；
   3. 改动列表里那条工作树池的注解（git 把整棵未跟踪目录折叠成一条）；
   4. chip 上一颗工作树标记；
   5. 会话的生效目录一变（`workingDirectory` 投影），chip 和面板就要重读。 */

const WT_W1 = '/tmp/ws/.agents/worktrees/w1'
const WT_GONE = '/tmp/ws/.agents/worktrees/gone'
const WT_LIST = {
  ok: true, repo: '/tmp/ws', current: WT_W1, main: '/tmp/ws', linked: true, pool: '.agents/worktrees',
  entries: [
    { path: '/tmp/ws', rel: '', name: 'main', detached: false, head: 'a'.repeat(40), short: 'aaaaaaa', subject: 'base commit', locked: false, lockReason: '', prunable: false, pruneReason: '', bare: false, main: true, current: false },
    { path: WT_W1, rel: '.agents/worktrees/w1', name: 'w1', detached: false, head: 'b'.repeat(40), short: 'bbbbbbb', subject: 'worktree tip', locked: true, lockReason: '别动它', prunable: false, pruneReason: '', bare: false, main: false, current: true },
    { path: WT_GONE, rel: '.agents/worktrees/gone', name: 'gone', detached: false, head: 'c'.repeat(40), short: 'ccccccc', subject: 'gone tip', locked: false, lockReason: '', prunable: true, pruneReason: '目录不在了', bare: false, main: false, current: false },
  ],
}
/* 这个工作区的那一次读：仓库是池里的 w1（链接工作树）。 */
const OK_WT = Object.assign({}, OK_PANEL, { repo: WT_W1, branch: 'w1', worktree: { linked: true, name: 'w1' } })
const OK_PLAIN = Object.assign({}, OK_PANEL, { worktree: null })
/* 一条折叠起来的工作树池改动，外加一个真正属于读者的未跟踪文件。 */
const OK_DIRTY = Object.assign({}, OK_WT, {
  untracked: [{ path: '.agents/', code: '??' }, { path: 'notes.txt', code: '??' }],
})

const realCall2 = host.call
const calls2 = []
let worktreeReply = WT_LIST
let panelReply = OK_WT
host.call = function (method, args) {
  calls2.push({ method, args })
  if (method === 'git/worktrees') return Promise.resolve(worktreeReply)
  if (method === 'git/panel') return Promise.resolve(panelReply)
  return realCall2(method, args)
}
const panelCalls = () => calls2.filter((c) => c.method === 'git/panel')
const worktreeCalls = () => calls2.filter((c) => c.method === 'git/worktrees')
const tabNamed = (tree, label) => byClass(tree, 'dsh-git-tab').find((b) => textOf(b).indexOf(label) >= 0)
const rowsOf = (tree) => byClass(tree, 'dsh-git-wt-row')
const rowNamed = (tree, name) => rowsOf(tree).find((r) => textOf(r).indexOf(name) >= 0)

console.log('== 面板头上：只有一颗 chip，它在工作树里换字形 ==')
/* 这里曾经并排两颗按钮：一颗写分支名、一颗写工作树名 —— 而 DSH 默认拿分支名给工作树
   命名，屏幕上就是两个几乎一样的词顶着两颗分支样的图标。现在合成一颗：链接工作树里
   它把**最前面那颗图标**换成工作树字形（和输入框那颗 chip 同一个做法），页签仍然是
   去工作树列表的路。 */
let panelTree = await openPanel()
const headerChips = byClass(panelTree, 'dsh-git-branch-chip')
console.log('  头部 chip:', headerChips.map(textOf))
ok('头上只有一颗分支 chip（没有第二颗"工作树"按钮）',
  headerChips.length === 1 && byClass(panelTree, 'dsh-git-wtchip').length === 0)
ok('它在链接工作树里画的是工作树字形',
  headerChips.length === 1 && collect(headerChips[0]).some((n) => n.type === 'path'
    && typeof n.props.d === 'string' && n.props.d.indexOf('M12.854') === 0))
ok('并且不再画分支字形（同一颗位置上不会两个字形都在）',
  headerChips.length === 1 && collect(headerChips[0]).every((n) => n.type !== 'circle'))
ok('这颗 chip 上没有悬浮提示（title 去掉了）',
  headerChips.length === 1 && headerChips[0].props.title === undefined)
/* 分支名来自 refs/图那一次读（不是这份 mock 里的 work 答复），所以这里只验它写着
   一个名字 —— 有没有名字是 gp37/gp40 那些套件的事。 */
ok('分支名照旧写着', headerChips.length === 1 && textOf(headerChips[0]).length > 0)

console.log('')
console.log('== 工作树页签：列出全部树，标出主/当前/锁定/可清理 ==')
const tabs = byClass(panelTree, 'dsh-git-tab').map(textOf)
console.log('  页签:', JSON.stringify(tabs))
ok('多了一个「工作树」页签', tabs.some((t) => t.indexOf('工作树') >= 0))
ok('页签上带着数量徽标（3 棵）',
  byClass(panelTree, 'dsh-git-tool-badge').some((b) => textOf(b) === '3'))
const wtTab = tabNamed(panelTree, '工作树')
wtTab.props.onClick()
/* label 决定 fiber：面板从头到尾用同一个 label，切页签才是"同一个组件换 state"，
   而不是重新挂一个（见 harness 的 renderRoot）。 */
panelTree = await settle()
const wtRows = rowsOf(panelTree)
console.log('  行:', wtRows.map(textOf))
ok('列出三棵工作树', wtRows.length === 3)
ok('当前那一棵被标出来', byClass(panelTree, 'dsh-git-wt-row-on').length === 1
  && byClass(panelTree, 'dsh-git-wt-row-on')[0] === rowNamed(panelTree, 'w1'))
const badges = byClass(panelTree, 'dsh-git-wt-badge').map(textOf)
console.log('  徽标:', JSON.stringify(badges))
ok('主工作树、当前、锁定、可清理都被说出来',
  badges.indexOf('主') >= 0 && badges.indexOf('当前') >= 0
  && badges.indexOf('锁定') >= 0 && badges.indexOf('可清理') >= 0)
ok('每一行都带着它的路径（读者要能确认是哪一份检出）',
  wtRows.every((r) => textOf(r).indexOf('/tmp/ws') >= 0))
ok('页签里写着这个池在哪、那条未跟踪改动是什么、怎么让它别再出现',
  textOf(byClass(panelTree, 'dsh-git-wt-head')[0]).indexOf('.agents/worktrees') >= 0
  && textOf(byClass(panelTree, 'dsh-git-wt-head')[0]).indexOf('.gitignore') >= 0)
/* 清单是"仓库的身份"这一级的东西，不是每次渲染都要问一遍的东西。 */
const readsBefore = worktreeCalls().length
for (let i = 0; i < 5; i += 1) panelTree = await settle()
await wait(10)
console.log('  再渲染 5 次的额外读:', worktreeCalls().length - readsBefore)
ok('工作树清单不会每次渲染都重读', worktreeCalls().length - readsBefore <= 1)

console.log('')
console.log('== 点别的树：只切这个面板，会话不动 ==')
calls2.length = 0
rowNamed(panelTree, 'gone').props.onClick()
await wait(20)
panelTree = await settle()
const switchCalls = panelCalls().filter((c) => c.args != null && c.args.repo === WT_GONE)
console.log('  切过去的请求:', JSON.stringify(switchCalls.slice(0, 2).map((c) => c.args.repo)))
ok('面板按那棵树重新读了一次', switchCalls.length > 0)
ok('读的就是那棵树的路径', switchCalls.every((c) => c.args.repo === WT_GONE))
/* 只切视图的意思：没有一条请求在"移动会话"——插件根本没有那种 RPC。 */
ok('没有任何"移动会话"的调用（插件不搬工作目录）',
  calls2.every((c) => c.method.indexOf('git/worktrees') === 0 || c.method.indexOf('git/panel') === 0
    || c.method.indexOf('git/') === 0))
ok('会话 id 一直跟着请求走（沙箱策略要它）',
  switchCalls.every((c) => c.args.sessionId === 's-1'))

console.log('')
console.log('== 改动列表：池那条改动被标出来，但不被藏掉 ==')
host.call = function (method, args) {
  calls2.push({ method, args })
  if (method === 'git/worktrees') return Promise.resolve(worktreeReply)
  if (method === 'git/panel') return Promise.resolve(args != null && args.quick === true ? OK_WT : OK_DIRTY)
  return realCall2(method, args)
}
panelReply = OK_DIRTY
panelTree = await openPanel()
const changesTab = tabNamed(panelTree, '变更')
changesTab.props.onClick()
panelTree = await settle()
const notes = byClass(panelTree, 'dsh-git-wtnote')
console.log('  标记:', notes.map(textOf))
ok('那条 .agents/ 改动带上了工作树注解', notes.length === 1 && textOf(notes[0]) === '工作树池')
ok('注解本身不再挂提示框（那句话搬进了工作树页签，见上一节）',
  notes.length === 1 && notes[0].props.title === undefined)
const untrackedRows = byClass(panelTree, 'dsh-git-trow').map(textOf)
console.log('  未跟踪行:', JSON.stringify(untrackedRows.filter((t) => t.length > 0).slice(-4)))
ok('那条改动照样列出来（标记，不隐藏）',
  untrackedRows.some((t) => t.indexOf('.agents') >= 0))
ok('读者自己的未跟踪文件没有被牵连', untrackedRows.some((t) => t.indexOf('notes.txt') >= 0))
ok('读者的文件没有被打标', byClass(panelTree, 'dsh-git-wtnote').every((n) => textOf(n) === '工作树池'))

console.log('')
console.log('== chip：前导图标自己换，而不是在后面再挂一颗 ==')
/* 在链接工作树里，chip **最前面那颗**图标从分支字形换成工作树字形（VS Code codicon
   的 worktree）：一个 glyph 读起来是一个按钮，两颗 flex 兄弟读起来像两个按钮。
   分支图标是三颗实心圆（cx=4 cy=3.5 那颗在）；工作树字形是一条实心路径，起手就是
   M12.854。两个判据各自独立，所以"换错了"和"两颗都在"都能被看见。 */
const glyphPaths = (tree) => collect(tree)
  .filter((n) => n.type === 'path' && typeof n.props.d === 'string')
  .map((n) => String(n.props.d))
const hasWorktreeGlyph = (tree) => glyphPaths(tree).some((d) => d.indexOf('M12.854') === 0)
const hasBranchGlyph = (tree) => collect(tree)
  .some((n) => n.type === 'circle' && n.props.cx === 4 && n.props.cy === 3.5)
host.call = function (method, args) {
  calls2.push({ method, args })
  if (method === 'git/panel') return Promise.resolve(panelReply)
  if (method === 'git/worktrees') return Promise.resolve(worktreeReply)
  return realCall2(method, args)
}
calls2.length = 0
panelReply = OK_WT
const chipTreeWt = await renderUntilStable(makeElement(chip, { sessionId: 's-wt' }), 'chip-wt')
console.log('  chip 文本:', JSON.stringify(textOf(chipTreeWt)))
ok('链接工作树里：前导图标是工作树字形', hasWorktreeGlyph(chipTreeWt))
ok('同一颗位置上不再画分支字形', hasBranchGlyph(chipTreeWt) !== true)
ok('没有在后面另挂一颗（整棵 chip 只有一个 svg）',
  collect(chipTreeWt).filter((n) => n.type === 'svg').length === 1)
ok('分支名照旧显示', textOf(chipTreeWt).indexOf('w1') >= 0)
ok('工作树这件事只说给字形和分支名，不在提示框里',
  chipTreeWt.props.title === undefined && hasWorktreeGlyph(chipTreeWt) && textOf(chipTreeWt).indexOf('w1') >= 0)

panelReply = OK_PLAIN
const chipTreePlain = await renderUntilStable(makeElement(chip, { sessionId: 's-plain' }), 'chip-plain')
ok('（对照）主工作树里还是那颗分支图标', hasBranchGlyph(chipTreePlain) === true)
ok('（对照）主工作树里没有工作树字形', hasWorktreeGlyph(chipTreePlain) !== true)

console.log('')
console.log('== 会话把工作目录搬进工作树：chip 要立刻重读 ==')
/* 这是 DSH 0.2 新增的那条信息（`workingDirectory` 投影）。它变了，仓库并没有动：
   `git/watch` 的签名完全可以不变，所以"重读"这件事必须由这个值触发。 */
calls2.length = 0
let projected = '/tmp/ws'
const projection = () => projected
const projectedChip = async (label) => renderUntilStable(
  makeElement(chip, { sessionId: 's-proj', useProjection: projection }), label)
let projTree = await projectedChip('chip-proj')
await wait(20)
const before = panelCalls().length
console.log('  搬目录之前的读:', before, '次')
projected = WT_W1
projTree = await projectedChip('chip-proj')
await wait(20)
const after = panelCalls().length
console.log('  搬目录之后的读:', after, '次（新增 ' + String(after - before) + '）')
ok('投影一变就重新读了一次', after > before)
ok('重读仍带着这个会话', panelCalls().every((c) => c.args.sessionId === 's-proj'))
/* 对照：投影值不变时不该反复重读——否则每次渲染都往 Host 打一发。 */
const stable = panelCalls().length
projTree = await projectedChip('chip-proj')
await wait(20)
ok('（对照）投影没变就不重读', panelCalls().length === stable)

console.log('')
console.log('== 读不成时说的话：分得清"没有工作区"和"不是仓库" ==')
/* Host 这一份读用 `error` 说"为什么没读成"（面板那几位读用 `reason`）。客户端曾经
   只认后者，"还不知道这个会话的工作区在哪"那一句因此永远说不出口 —— 每种失败都被
   说成"不是一个 Git 仓库"。这里两种失败各走一遍，把那条路钉住。 */
const openWorktreesTab = async (label) => {
  const first = await renderUntilStable(makeElement(popover, { sessionId: 's-1' }), label)
  tabNamed(first, '工作树').props.onClick()
  return await settle(label)
}
worktreeReply = { ok: false, repo: null, error: 'no-path', current: '', pool: '.agents/worktrees', entries: [] }
const noPathTree = await openWorktreesTab('pop-nopath')
console.log('  没有工作区:', JSON.stringify(textOf(noPathTree).slice(0, 90)))
ok('没有工作区时说的是"还不知道这个会话的工作区在哪"',
  textOf(noPathTree).indexOf('还不知道这个会话的工作区在哪') >= 0)

worktreeReply = { ok: false, repo: '/tmp/ws', error: 'not-a-repository', noGit: false, current: '', pool: '.agents/worktrees', entries: [] }
const notRepoTree = await openWorktreesTab('pop-notrepo')
console.log('  不是仓库:', JSON.stringify(textOf(notRepoTree).slice(0, 90)))
ok('不是仓库时说的是仓库的事，不再提工作区',
  textOf(notRepoTree).indexOf('不是一个 Git 仓库') >= 0
  && textOf(notRepoTree).indexOf('还不知道这个会话的工作区在哪') < 0)

worktreeReply = { ok: false, repo: '/tmp/ws', error: 'not-a-repository', noGit: true, current: '', pool: '.agents/worktrees', entries: [] }
const noGitTree = await openWorktreesTab('pop-nogit')
ok('机器上没有 git 时说的是 git 的事',
  textOf(noGitTree).indexOf('这台机器上找不到 git') >= 0)
