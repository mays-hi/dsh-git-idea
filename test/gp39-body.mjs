
/* ── 切换工作区：chip 不能还显示上一个工作区的分支 ── */

/* 芯片现在分两段读：先便宜的「哪个仓库哪个分支」，再补工作区状态。
   这个套件要观察的是**第一段还没回来**时的中间态，所以第一段挂住由测试
   逐个放行，第二段（完整读）立刻用该会话已知的答案回掉 —— 它的时序不是
   这里要考的东西。 */
const realCall = host.call
const panelArgs = []
let panelResolvers = []
const settled = {}
host.call = function (method, args) {
  if (method === 'git/panel') {
    panelArgs.push(args)
    const sid = args == null ? undefined : args.sessionId
    if (args != null && args.quick === true) {
      return new Promise(function (resolve) { panelResolvers.push({ sid: sid, resolve: resolve }) })
    }
    return Promise.resolve(settled[sid] !== undefined ? settled[sid] : { ok: false, repo: null, reason: '' })
  }
  return realCall(method, args)
}
const panelPending = () => panelResolvers.length
const answerPanel = async (reply) => {
  const next = panelResolvers.shift()
  if (next === undefined) throw new Error('没有待决的 git/panel 请求')
  settled[next.sid] = reply
  next.resolve(reply)
  await new Promise((r) => setTimeout(r, 5))
}
/* 同一个 fiber 换 props —— 这才是真实的「切换工作区」；label 必须稳定，
   否则每次都是一个全新挂载的组件，测的就成了挂载而不是切换。 */
const chipFor = (sessionId) => renderUntilStable(makeElement(chip, { sessionId: sessionId }), 'chip')
const fireTimers = () => {
  timers.filter((t) => t.kind === 'timeout' && !t.dead).forEach((t) => { t.dead = true; t.cb() })
}
const branchesFor = (repo) => calls.filter((c) => c.method === 'git/branches' && c.args != null && c.args.repo === repo)
/* 每条改动一个**不同的**路径：同一份快照里同一个 path 出现两次不是 git 会给出的东西，
   而「有几个改动」现在是那份列表的行数（mergeChanges，面板标签上那个数字），同一个
   路径只会是一行。 */
const panelOf = (repo, branch, pending) => ({
  ok: true, repo: repo, branch: branch, detached: false, upstream: 'origin/' + branch,
  ahead: 0, behind: 0, sequencer: null,
  staged: [], unstaged: new Array(pending || 0).fill(0).map((_x, i) => 'f' + i), untracked: [], unmerged: [],
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
console.log('')
console.log('== 同一个工作区里换会话：面板第一帧就用记忆里那份，不闪「正在读取仓库…」 ==')

/* DSH 换会话时整棵 session 作用域的 slot 子树会重挂，组件 state 全部从头来。但
   s-2 的 chip 已经读过它的工作区（/tmp/ws2，1 个改动），那份快照按仓库记在全局读数
   里 —— 所以重挂出来的面板第一帧就该是它，而不是先空一帧「正在读取仓库…」。 */
const seededFrame = renderRoot(makeElement(popover, { sessionId: 's-2' }), 'pop-seeded')
const seededText = textOf(seededFrame)
const seededBadge = byClass(seededFrame, 'dsh-git-tool-badge')[0]
console.log('  重挂后的第一帧:', JSON.stringify(seededText.slice(0, 130)))
console.log('  第一帧上的变更数:', seededBadge === undefined ? '(没有)' : JSON.stringify(textOf(seededBadge)))
ok('第一帧不再是「正在读取仓库…」', seededText.indexOf('正在读取仓库') < 0)
ok('第一帧就带着记忆里那份改动数', seededBadge !== undefined && textOf(seededBadge) === '1')

/* 没有记忆的会话（这个工作区从来没读过）必须照旧先空一帧，不能凭空编一个仓库出来。 */
const coldFrame = renderRoot(makeElement(popover, { sessionId: 's-cold' }), 'pop-cold')
console.log('  没见过的会话第一帧:', JSON.stringify(textOf(coldFrame).slice(0, 130)))
ok('没见过的会话仍从「正在读取仓库…」开始', textOf(coldFrame).indexOf('正在读取仓库') >= 0)
