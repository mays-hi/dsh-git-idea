
/* ── 一个工作区里的几个仓库 ──

   DSH 的会话目录常常是「装着若干项目的那一层」：它自己不是仓库，而下面有好几个。这条
   套件守的是这件事在屏幕上说得清：

   1. 不是仓库的目录：引导页把下面扫到的仓库一行一个列出来，点一个就打开它；
   2. 不止一个仓库时，面板头上那颗 chip（分支那颗）展开的卡片**第一组**就是它们，点一行
      换一个 —— 换的只是「看哪一个」，不搬会话；面板头上没有第二颗「仓库」chip（它和这颗
      打开的是同一件事，收掉了，见下面那一节）；
   3. 输入框那颗 chip：工作区下面有仓库时说的是「N 个仓库」，而不是「不是仓库」。

   清单本身（往下扫、跳过产物目录、只认 .git 目录、工作区外面的路径被拒）由 Host 那一半
   守住，见 gp34a 的最后一节；这里只管屏幕怎么用它。

   一个工作区换一次会话：面板的重挂和 DSH 换会话时一样（appliedRepo 是会话自己的）。

   这一段跑在 gp48 铺开的宿主上：openPanel() 先把面板打开（props.ready 是面板开始读的
   前提），下面每一组再各自换一个 sessionId + label —— label 就是这套玩具渲染器的 fiber
   路径，换一个就是干净的一份 state。 */

const WS = '/tmp/ws-multi'
const DEEP = WS + '/beta/deep'
const WS_ROOT = '/tmp/ws-root'
const NESTED_ROOT = WS_ROOT + '/apps/web'

const realCall49 = host.call
const calls49 = []
let rootsReply = { ok: true, workspace: WS, depth: 2, truncated: false, roots: [] }
let defaultPanel = OK_PANEL
const repoPanels = {}
const panelForRepo = (repo) => (repoPanels[repo] !== undefined ? repoPanels[repo] : defaultPanel)
host.call = function (method, args) {
  calls49.push({ method: method, args: args })
  if (method === 'git/repos') return rootsReply === null ? Promise.reject(new Error('git/repos is not registered')) : Promise.resolve(rootsReply)
  if (method === 'git/panel') {
    const repo = args != null && typeof args.repo === 'string' && args.repo.length > 0 ? args.repo : ''
    return Promise.resolve(panelForRepo(repo))
  }
  /* 分支 chip 的名字来自 git/refs（不是 git/panel）：这里让它跟着这个仓库的答复走，
     否则换过去之后 chip 还会写着上一个仓库的分支。 */
  if (method === 'git/refs') {
    const repo = args != null && typeof args.repo === 'string' ? args.repo : ''
    const panel = panelForRepo(repo)
    return Promise.resolve({
      ok: true, repo: repo,
      current: panel.ok === true && typeof panel.branch === 'string' ? [panel.branch] : [],
      /* 清单里也放两条分支：卡片上「仓库那一组下面还是分支」这件事要有东西可看。 */
      local: [{ segments: ['main'], data: 'main', upstream: 'origin/main', ahead: 0, behind: 0, at: 1 }],
      remote: [{ name: 'origin', refs: [{ segments: ['main'], data: 'origin/main' }] }],
    })
  }
  return realCall49(method, args)
}
const repoCallsOf = (method) => calls49.filter((c) => c.method === method)
const askedRepos = () => repoCallsOf('git/panel').map((c) => (c.args != null && c.args.repo !== undefined ? c.args.repo : '(会话工作区)'))
const panelAt = (sessionId, label) => renderUntilStable(makeElement(popover, { sessionId: sessionId }), label)
const setupReply = {
  ok: false, repo: WS, error: 'not-a-repository', reason: 'not-a-repo',
  stderr: '', exitCode: null, staged: [], unstaged: [], untracked: [], unmerged: [], worktree: null,
}
const branchPanel = (repo, branch) => Object.assign({}, OK_PANEL, { repo: repo, branch: branch })

/* 面板先打开一次：props.ready 是它开始读的前提（别的套件也是这么进来的）。 */
await openPanel()

console.log('')
console.log('== 不是仓库的工作区：引导页把下面的仓库列出来 ==')
rootsReply = {
  ok: true, workspace: WS, depth: 2, truncated: false,
  roots: [
    { path: WS + '/alpha', rel: 'alpha', branch: 'feature-a', depth: 1 },
    { path: DEEP, rel: 'beta/deep', branch: 'deep-branch', depth: 2 },
  ],
}
defaultPanel = setupReply
repoPanels[DEEP] = branchPanel(DEEP, 'deep-branch')
const setupTree = await panelAt('s-a', 'gp49a')
const listed = byClass(setupTree, 'dsh-git-setup-root')
ok('这一份读问的是会话工作区', repoCallsOf('git/repos').length > 0)
ok('两行都列出来了', listed.length === 2, textOf(setupTree))
ok('每一行写着相对路径、分支和完整路径',
  listed.length === 2 && textOf(listed[0]).indexOf('alpha') >= 0 && textOf(listed[0]).indexOf('feature-a') >= 0 && textOf(listed[0]).indexOf(WS + '/alpha') >= 0,
  textOf(listed.length === 2 ? listed[0] : setupTree))
ok('第二层的那一个也在（写的是 beta/deep）', listed.length === 2 && textOf(listed[1]).indexOf('beta/deep') >= 0,
  listed.length === 2 ? textOf(listed[1]) : '')
ok('名单里的按钮一个浏览器提示框都没有', listed.every((b) => b.props.title === undefined))

console.log('')
console.log('== 点一行就是打开它：面板换成读那一个仓库 ==')
listed[1].props.onClick()
await wait(10)
const afterPick = await panelAt('s-a', 'gp49a')
const branchChipAfter = byClass(afterPick, 'dsh-git-branch-chip')[0]
ok('点的那一个成了这次请求的仓库', askedRepos().indexOf(DEEP) >= 0, askedRepos())
ok('面板头上一颗 chip 写着它的分支',
  branchChipAfter !== undefined && textOf(branchChipAfter).indexOf('deep-branch') >= 0,
  branchChipAfter === undefined ? textOf(afterPick) : textOf(branchChipAfter))

console.log('')
console.log('== 一个工作区里有几个仓库：那颗 chip 展开的卡片，第一组 ==')
/* 面板头上只有一颗 chip（分支那颗）—— 原来还有第二颗「仓库」chip，它和这一颗打开的是同一
   件事，两颗并排时还常常写着同一个词（DSH 默认拿分支名给工作树命名，工作区那份检出的目录
   名和分支名就一样），所以收了：仓库那一组本来就在这张卡片最上面，星标说的是现在看的一个。 */
rootsReply = {
  ok: true, workspace: WS_ROOT, depth: 2, truncated: false,
  roots: [
    { path: WS_ROOT, rel: '', branch: 'main', depth: 0 },
    { path: NESTED_ROOT, rel: 'apps/web', branch: 'web-branch', depth: 2 },
  ],
}
defaultPanel = branchPanel(WS_ROOT, 'main')
repoPanels[NESTED_ROOT] = branchPanel(NESTED_ROOT, 'web-branch')
const rootTree = await panelAt('s-b', 'gp49b')
const repoChipB = byClass(rootTree, 'dsh-git-root-chip')[0]
ok('多仓库时顶栏那颗「仓库」chip 在，写着现在看的是哪一个、一共几个',
  repoChipB !== undefined && textOf(repoChipB).indexOf('ws-root') >= 0 && textOf(repoChipB).indexOf('2') >= 0,
  repoChipB === undefined ? textOf(rootTree).slice(0, 120) : textOf(repoChipB))
ok('它和旁边那颗分支 chip 打开的是同一张卡片',
  byClass(rootTree, 'dsh-git-branch-chip').length === 1)
repoChipB.props.onClick()
await wait(10)
const cardTree = await panelAt('s-b', 'gp49b')
const rootRows = byClass(cardTree, 'dsh-git-root-row')
ok('不止一个仓库时，那一组在卡片里（两行）', rootRows.length === 2, textOf(cardTree).slice(0, 200))
ok('当前那一个带星，写的是目录名',
  rootRows.length === 2 && textOf(rootRows[0]).indexOf('★') >= 0 && textOf(rootRows[0]).indexOf('ws-root') >= 0,
  rootRows.length === 2 ? textOf(rootRows[0]) : '')
ok('另一行写着它的相对路径和分支',
  rootRows.length === 2 && textOf(rootRows[1]).indexOf('apps/web') >= 0 && textOf(rootRows[1]).indexOf('web-branch') >= 0,
  rootRows.length === 2 ? textOf(rootRows[1]) : '')
ok('同一张卡片下面还是分支（本地/远端那些组）',
  textOf(cardTree).indexOf('本地') >= 0 && textOf(cardTree).indexOf('远端') >= 0,
  textOf(cardTree).slice(0, 200))

console.log('')
console.log('== 点另一行：换一个仓库看 ==')
rootRows[1].props.onClick()
await wait(10)
const switched = await panelAt('s-b', 'gp49b')
ok('请求换成了那一个', askedRepos().indexOf(NESTED_ROOT) >= 0, askedRepos())
ok('面板头上那颗 chip 现在写的是新仓库的分支',
  byClass(switched, 'dsh-git-branch-chip').length === 1
  && textOf(byClass(switched, 'dsh-git-branch-chip')[0]).indexOf('web-branch') >= 0,
  byClass(switched, 'dsh-git-branch-chip')[0] === undefined ? '' : textOf(byClass(switched, 'dsh-git-branch-chip')[0]))

console.log('')
console.log('== 只有一个仓库时，那一组不出现 ==')
rootsReply = { ok: true, workspace: WS, depth: 2, truncated: false, roots: [{ path: WS + '/alpha', rel: 'alpha', branch: 'feature-a', depth: 1 }] }
repoPanels[WS + '/alpha'] = branchPanel(WS + '/alpha', 'feature-a')
const oneTree = await panelAt('s-c', 'gp49c')
ok('没有仓库那一行', byClass(oneTree, 'dsh-git-root-row').length === 0)
ok('只有一个仓库时那颗「仓库」chip 也不出现', byClass(oneTree, 'dsh-git-root-chip').length === 0)

console.log('')
console.log('== 输入框那颗 chip：不是仓库，但下面有 N 个 ==')
rootsReply = {
  ok: true, workspace: WS, depth: 2, truncated: false,
  roots: [
    { path: WS + '/alpha', rel: 'alpha', branch: 'feature-a', depth: 1 },
    { path: DEEP, rel: 'beta/deep', branch: 'deep-branch', depth: 2 },
  ],
}
defaultPanel = setupReply
const chipTree49 = await renderUntilStable(makeElement(chip, { sessionId: 's-d' }), 'gp49chip')
ok('chip 写的是「2 个仓库」，不是「不是仓库」',
  textOf(chipTree49).indexOf('2 个仓库') >= 0, textOf(chipTree49))
ok('它自己就把清单读回来了（面板没开也能说这句话）',
  repoCallsOf('git/repos').some((c) => c.args != null && c.args.sessionId === 's-d'))

console.log('')
console.log('== 悬浮卡片：不打开面板也能换仓库 ==')
/* 工作区自己是仓库、里面还有别人的检出：这时候 chip 上悬停出来的那张卡片也得能换 ——
   不然「换一个仓库看」就只藏在面板里，而读者常看的那一面是输入框旁那颗 chip。 */
rootsReply = {
  ok: true, workspace: WS, depth: 2, truncated: false,
  roots: [
    { path: WS, rel: '', branch: 'main', depth: 0 },
    { path: DEEP, rel: 'beta/deep', branch: 'deep-branch', depth: 2 },
  ],
}
defaultPanel = branchPanel(WS, 'main')
repoPanels[DEEP] = branchPanel(DEEP, 'deep-branch')
const fire49 = function () {
  timers.filter(function (t) { return t.kind === 'timeout' && t.dead !== true }).forEach(function (t) { t.cb() })
}
const hoverSession = 's-hover49'
let hoverChip = await renderUntilStable(makeElement(chip, { sessionId: hoverSession }), 'gp49hoverchip')
if (hoverChip.props.className.indexOf('dsh-git-chip-open') >= 0) { hoverChip.props.onClick(); await wait(10) }
hoverChip = await renderUntilStable(makeElement(chip, { sessionId: hoverSession }), 'gp49hoverchip')
hoverChip.props.onPointerEnter()
fire49()
await wait(15)
let hoverCard = await panelAt(hoverSession, 'gp49hover')
hoverCard = await panelAt(hoverSession, 'gp49hover')
const hoverRoots = byClass(hoverCard, 'dsh-git-root-row')
ok('悬浮卡片里有仓库清单（面板没开也会有）',
  byClass(hoverCard, 'dsh-git-switch-hover').length === 1 && hoverRoots.length === 2, String(hoverRoots.length))
ok('当前那一个带星，另一行写着相对路径和分支',
  hoverRoots.length === 2 && textOf(hoverRoots[0]).indexOf('★') >= 0
  && textOf(hoverRoots[1]).indexOf('beta/deep') >= 0 && textOf(hoverRoots[1]).indexOf('deep-branch') >= 0,
  hoverRoots.length === 2 ? textOf(hoverRoots[1]) : textOf(hoverCard).slice(0, 120))
const branchesBefore = calls49.filter(function (c) { return c.method === 'git/branches' }).length
hoverRoots[1].props.onClick()
await wait(15)
hoverCard = await panelAt(hoverSession, 'gp49hover')
const branchCalls = calls49.filter(function (c) { return c.method === 'git/branches' })
ok('点另一行：分支列表按那一个仓库重读',
  branchCalls.length > branchesBefore && branchCalls[branchCalls.length - 1].args.repo === DEEP,
  JSON.stringify(branchCalls.length > 0 ? branchCalls[branchCalls.length - 1].args : null))
hoverChip = await renderUntilStable(makeElement(chip, { sessionId: hoverSession }), 'gp49hoverchip')
await wait(10)
ok('chip 也跟着搬过去了（下一次读问的是那一个仓库）', askedRepos().indexOf(DEEP) >= 0, askedRepos())
console.log('')
console.log('== 工作区外面的路径：说得清为什么打不开 ==')
rootsReply = { ok: true, workspace: WS, depth: 2, truncated: false, roots: [] }
defaultPanel = {
  ok: false, repo: '/tmp/somewhere-else', error: 'not-a-repository', reason: 'outside',
  workspace: WS, stderr: '', exitCode: null, staged: [], unstaged: [], untracked: [], unmerged: [], worktree: null,
}
const outsideTree = await panelAt('s-e', 'gp49e')
ok('引导页说的是「不在会话工作区里」', textOf(outsideTree).indexOf('这个路径不在会话工作区里') >= 0, textOf(outsideTree))
ok('它把工作区是哪个写出来了', textOf(outsideTree).indexOf(WS) >= 0)
ok('路径框还在（可以改成工作区里的路径）', byClass(outsideTree, 'dsh-git-input').length > 0)

console.log('')
console.log('== Host 上还没有这条路（先升了一半）：问过就不再问，屏幕照旧 ==')
/* git/repos 是和这一份 Client 一起发出来的，但动态桥热更、或者一个页面连着刚升了一半的
   部署时，Host 还认不出这个方法 —— 答复是 `... is not registered`，而 callHost 会为它重试
   24 次。客户端要一次就记住这条路不在，然后该画什么画什么（「不是仓库」那条压根不靠它）。 */
rootsReply = null
defaultPanel = setupReply
const askedReposCount = () => repoCallsOf('git/repos').length
const fireTimeouts = () => timers.filter((t) => t.kind === 'timeout' && t.dead !== true).forEach((t) => t.cb())
await panelAt('s-f', 'gp49f')
const firstAsk = askedReposCount()
ok('Host 认不出这个方法的第一次，会问一次', firstAsk > 0, String(firstAsk))
for (let i = 0; i < 30; i += 1) { fireTimeouts(); await wait(5) }
const beforeSecond = askedReposCount()
const secondPanel = await panelAt('s-g', 'gp49g')
ok('之后新开的面板不再问（那条路不在这个 Host 上）', askedReposCount() === beforeSecond,
  String(askedReposCount()) + ' vs ' + String(beforeSecond))
ok('面板照旧把这一页画出来', textOf(secondPanel).indexOf('这个目录不是 Git 仓库') >= 0, textOf(secondPanel).slice(0, 80))

console.log('')
host.call = realCall49
ok('桩收回来了', host.call === realCall49)
