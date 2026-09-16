
/* ── 切换工作区：chip 不能还显示上一个工作区的分支 ── */

const realCall = host.call
const panelArgs = []
let panelResolvers = []
host.call = function (method, args) {
  if (method === 'git/panel') {
    panelArgs.push(args)
    return new Promise(function (resolve) { panelResolvers.push(resolve) })
  }
  return realCall(method, args)
}
const panelPending = () => panelResolvers.length
const answerPanel = async (reply) => {
  const resolve = panelResolvers.shift()
  if (resolve === undefined) throw new Error('没有待决的 git/panel 请求')
  resolve(reply)
  await new Promise((r) => setTimeout(r, 5))
}
/* 同一个 fiber 换 props —— 这才是真实的「切换工作区」；label 必须稳定，
   否则每次都是一个全新挂载的组件，测的就成了挂载而不是切换。 */
const chipFor = (sessionId) => renderUntilStable(makeElement(chip, { sessionId: sessionId }), 'chip')
const fireTimers = () => {
  timers.filter((t) => t.kind === 'timeout' && !t.dead).forEach((t) => { t.dead = true; t.cb() })
}
const branchesFor = (repo) => calls.filter((c) => c.method === 'git/branches' && c.args != null && c.args.repo === repo)
const panelOf = (repo, branch, pending) => ({
  ok: true, repo: repo, branch: branch, detached: false, upstream: 'origin/' + branch,
  ahead: 0, behind: 0, sequencer: null,
  staged: [], unstaged: new Array(pending || 0).fill('f'), untracked: [], unmerged: [],
})

console.log('== 先在那个工作区里待一会儿 ==')
calls.length = 0
let chipTree1 = await chipFor('s-1')
ok('chip 先要求读这个工作区', panelArgs.length === 1 && panelArgs[0].sessionId === 's-1')
await answerPanel(panelOf('/tmp/ws', 'main', 2))
chipTree1 = await chipFor('s-1')
console.log('  s-1 的按钮:', JSON.stringify(textOf(chipTree1)))
ok('读到分支后按钮写 main', textOf(chipTree1).indexOf('main') >= 0)
ok('带来改动数徽标', textOf(chipTree1).indexOf('2') >= 0)
ok('顺手预热了这个仓库的分支列表（不用等打开弹层）', branchesFor('/tmp/ws').length === 1)

console.log('')
console.log('== 切到另一个工作区：不能还挂着上一个的分支 ==')
panelArgs.length = 0
let chipTree2 = await chipFor('s-2')
await new Promise((r) => setTimeout(r, 5))
chipTree2 = await chipFor('s-2')
console.log('  s-2 还没读回来时的按钮:', JSON.stringify(textOf(chipTree2)))
ok('切过去后马上就不再显示上个工作区的 main', textOf(chipTree2).indexOf('main') < 0)
ok('也不再挂着上个工作区的改动数', textOf(chipTree2).indexOf('2') < 0)
ok('为 s-2 发了新的一次读', panelArgs.length >= 1 && panelArgs[panelArgs.length - 1].sessionId === 's-2')
await answerPanel(panelOf('/tmp/ws2', 'dev', 1))
chipTree2 = await chipFor('s-2')
console.log('  s-2 读回来后的按钮:', JSON.stringify(textOf(chipTree2)))
ok('读到后按钮写 dev', textOf(chipTree2).indexOf('dev') >= 0)
ok('预热了 s-2 自己的仓库', branchesFor('/tmp/ws2').length === 1)

console.log('')
console.log('== 切回去：记忆里的分支立刻出现，不等往返 ==')
ok('切到 s-2 之前没有遗留的未决读', panelPending() === 0)
let chipTree3 = await chipFor('s-1')
await new Promise((r) => setTimeout(r, 5))
chipTree3 = await chipFor('s-1')
console.log('  s-1 重新读回来之前的按钮:', JSON.stringify(textOf(chipTree3)), ' 未决读:', panelPending())
ok('切回 s-1 立刻又显示 main（用的是记住的标签）', textOf(chipTree3).indexOf('main') >= 0)
ok('这次读还没回来就已经显示了', panelPending() > 0)
await answerPanel(panelOf('/tmp/ws', 'main', 0))
chipTree3 = await chipFor('s-1')
ok('读回来之后仍然是 main', textOf(chipTree3).indexOf('main') >= 0)

console.log('')
console.log('== 预热过的仓库：hover 卡片第一次渲染就有分支 ==')
host.call = realCall
calls.length = 0
const chipTree4 = await chipFor('s-1')
chipTree4.props.onPointerEnter()
fireTimers()
await wait(15)
/* renderRoot 只渲染一遍、不等待 promise，所以「第一帧」是可观察的：
   预热过的仓库这一帧就有分支行，没预热就只有「正在读取分支…」。 */
const firstFrame = renderRoot(makeElement(popover, { sessionId: 's-2' }), 'pop')
const firstCard = byClass(firstFrame, 'dsh-git-switch-hover')[0]
ok('s-2 的 hover 卡片已经在了', firstCard !== undefined)
const firstRows = firstCard === undefined ? [] : byClass(firstCard, 'dsh-git-bs-row')
console.log('  第一帧里的行:', JSON.stringify(firstRows.map(textOf).slice(0, 5)))
ok('预热过：第一帧就列出了分支（不是「正在读取分支…」）', firstRows.length > 0)
ok('读的是 s-2 自己的仓库 /tmp/ws2', calls.filter((c) => c.method === 'git/branches').every((c) => c.args.repo === '/tmp/ws2'))
