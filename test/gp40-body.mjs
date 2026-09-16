/* ═══ gp40：重构之后新增的能力 ═══
   1. 存储层：旧键迁移、页面拒绝存储时不出事
   2. 历史列表窗口化：只画视口内的行、占位块补足高度、没有高度信息时回退
   3. 行级记忆：只重画该动的行，而且不会把数据冻住
   4. 分支列表：高亮跟着鼠标走，记忆照样如实反映新状态 */

/* ── 1. 存储层 ── */

/* 重写过之后不再兼容旧名字：只认 dsh.git-idea.*，老键放着也不会被读 */
store['dsh.gitops.settings'] = JSON.stringify({ watchEnabled: false, watchFastSec: 7, watchSlowSec: 30, hoverSwitch: true })
store['dsh.gitops.mru'] = JSON.stringify(['legacy-branch'])
store['dsh.git-idea.stars'] = JSON.stringify(['already-new'])

await openPanel()

console.log('')
console.log('== 存储层 ==')
ok('老 settings 键不再被读取', String(store['dsh.git-idea.settings'] || '').indexOf('7') < 0)
ok('老 mru 键不再被读取', String(store['dsh.git-idea.mru'] || '').indexOf('legacy-branch') < 0)
ok('老键没有被改写（也不再被复制）', store['dsh.gitops.mru'] === JSON.stringify(['legacy-branch']))
ok('新键里的既有内容原样保留', JSON.parse(store['dsh.git-idea.stars'])[0] === 'already-new')

/* 改一个设置：写进的就是新键，而且写的是默认值而不是老键里的 7 秒 */
const settingsTree = await renderUntilStable(makeElement(section, {}), 'gp40-store')
/* 第一个勾选框属于「插件配置」（写进 Host 的配置文件），本浏览器的设置从第二个开始 */
const localBoxes = inputs(settingsTree).filter((n) => n.props.type === 'checkbox')
localBoxes[1].props.onChange({ target: { checked: false } })
await wait(10)
const savedSettings = JSON.parse(store['dsh.git-idea.settings'])
ok('设置写进 dsh.git-idea.settings', savedSettings.watchEnabled === false)
ok('写进去的是默认值，不是老键里的 7 秒', savedSettings.watchFastSec === 3)

/* 页面拒绝存储时：设置页照样渲染，写入不抛错 */
const realStorage = fakeDoc.defaultView.localStorage
fakeDoc.defaultView.localStorage = {
  getItem() { throw new Error('storage disabled') },
  setItem() { throw new Error('storage disabled') },
}
let refused = false
try {
  const tree = await renderUntilStable(makeElement(section, {}), 'gp40-nostore')
  refused = byClass(tree, 'dsh-git-set').length === 1
  const check = inputs(tree).find((n) => n.props.type === 'checkbox')
  if (check !== undefined) check.props.onChange({ target: { checked: false } })
  const reset = buttons(tree).find((b) => textOf(b) === '恢复默认尺寸')
  if (reset !== undefined) reset.props.onClick()
} catch (failure) {
  refused = false
}
ok('存储被拒绝时设置页仍渲染、改写不抛错', refused === true)
fakeDoc.defaultView.localStorage = realStorage

/* ── 2. 历史列表窗口化 ── */

const ROW_H = 26
const COUNT = 200
const many = []
for (let i = 0; i < COUNT; i += 1) {
  many.push({ hash: 'h' + String(i).padStart(6, '0'), subject: 'commit ' + String(i), author: 'mays', date: '2026-09-16', committedAt: nowSec - i * 60, refs: [] })
}
const graphRows = (commits) => commits.map((c, i) => ({ lane: 0, edges: i + 1 < commits.length ? [{ hash: commits[i + 1].hash, lane: 0 }] : [] }))
graphCommits = many
const plainCall = host.call
host.call = function (method, args) {
  if (method !== 'git/graph') return plainCall.call(host, method, args)
  calls.push({ method, args })
  return Promise.resolve({ ok: true, repo: '/tmp/ws', ref: (args && args.ref) || 'main', currentBranch: 'main', commits: graphCommits, rows: graphRows(graphCommits), lanes: 1 })
}

/* 装上 200 个提交的假历史之后要触发一次重读：历史读取是靠筛选条件驱动的 */
byClass(await settle(), 'dsh-git-lf-select')[1].props.onChange({ target: { value: 'mays@example.com' } })
await wait(20)
await settle()

const crow = (tree) => byClass(tree, 'dsh-git-crow')
const padBlocks = (tree) => collect(tree).filter((n) => n.type === 'div' && n.props.className === undefined && n.props.style !== undefined && typeof n.props.style.height === 'string')
const padHeights = (tree) => padBlocks(tree).map((n) => n.props.style.height)

console.log('')
console.log('== 历史列表窗口化 ==')

/* 页面不肯说高度：和窗口化之前完全一样，全都画出来 */
fakeNode.clientHeight = 0
await settle()
const allTree = await settle()
ok('没有高度信息时仍然画满整个历史', crow(allTree).length === COUNT)
ok('没有高度信息时不放占位块', padBlocks(allTree).length === 0)

/* 600px 视口：只画视口 + overscan 圈得住的行 */
fakeNode.clientHeight = 600
fakeNode.scrollTop = 0
const winTree = await settle()
const winRows = crow(winTree)
ok('600px 视口只画 600/26 + 两圈 overscan = 32 行', winRows.length === 32)
ok('首行是第 0 个提交', textOf(winRows[0]).indexOf('commit 0') >= 0)
ok('DOM 节点比全量少一个数量级', collect(winTree).length < collect(allTree).length / 3)
ok('svg 只画窗口内的路径', collect(winTree).filter((n) => n.type === 'path').length < 60)
ok('底部占位块补足剩余高度', padHeights(winTree).join(',') === String((COUNT - 32) * ROW_H) + 'px')

/* 滚到 2600px：窗口跟着走，首行 = floor(2600/26) - 8 = 92 */
fakeNode.scrollTop = 2600
const deepTree = await settle()
const deepRows = crow(deepTree)
ok('滚动后首行是第 92 个提交', textOf(deepRows[0]).indexOf('commit 92') >= 0)
ok('滚动后仍是 40 行（视口 24 + 两圈 16）', deepRows.length === 40)
ok('上下两个占位块对齐：[92, 200-132] 行', padHeights(deepTree).join(',') === String(92 * ROW_H) + 'px,' + String((COUNT - 132) * ROW_H) + 'px')

/* 滚回顶部 */
fakeNode.scrollTop = 0
const backTree = await settle()
ok('滚回顶部又是第 0 行', textOf(crow(backTree)[0]).indexOf('commit 0') >= 0)

/* 窗口里的行照样能点，而且只读这一个提交 */
calls.length = 0
crow(backTree)[3].props.onClick()
await wait(20)
const picked = await settle()
const detailCalls = calls.filter((c) => c.method === 'git/commit-detail')
ok('点窗口内的行只读这一个提交', detailCalls.length === 1 && detailCalls[0].args.hash === 'h000003')
ok('被点的行带上选中样式', byClass(picked, 'dsh-git-crow-sel').length === 1 && textOf(byClass(picked, 'dsh-git-crow-sel')[0]).indexOf('commit 3') >= 0)

/* ── 3. 行级记忆 ── */

console.log('')
console.log('== 行级记忆（提交列表）==')
const skipsBefore = memoSkips
calls.length = 0
crow(picked)[5].props.onClick()
await wait(20)
const picked2 = await settle()
ok('再点一行：memo 跳过了没变的行', memoSkips > skipsBefore)
ok('选中样式只跟着新的那一行走', byClass(picked2, 'dsh-git-crow-sel').length === 1 && textOf(byClass(picked2, 'dsh-git-crow-sel')[0]).indexOf('commit 5') >= 0)
ok('选中时不为别的行读详情', calls.filter((c) => c.method === 'git/commit-detail').length === 1)

/* 记忆不能把数据冻住：换一份历史，行的内容必须跟着变 */
graphCommits = many.map((c, i) => (i === 5 ? Object.assign({}, c, { subject: '改写过的标题' }) : c))
byClass(picked2, 'dsh-git-lf-select')[1].props.onChange({ target: { value: '' } })
await wait(20)
const rewritten = await settle()
ok('历史变了，被记忆的行仍然如实更新', textOf(rewritten).indexOf('改写过的标题') >= 0)
ok('改写后仍然只有 32 行（窗口没有因为重读而失效）', crow(rewritten).length === 32)

/* ── 4. 分支列表 ── */

console.log('')
console.log('== 行级记忆（分支列表）==')
graphCommits = [
  { hash: 'aaa111', subject: 'tip commit', author: 'mays', date: '2026-09-16', committedAt: nowSec - 60, refs: ['HEAD -> dev'] },
]
fakeNode.clientHeight = 0
const swTree = await openSwitcher()
ok('分支行都渲染出来了', branchRows(swTree).length >= 4)

const enterRow = (tree, name, top) => rowWith(tree, name).props.onMouseEnter({ currentTarget: { offsetTop: top }, button: 0 })
enterRow(swTree, 'solo', 60)
await wait(20)
const hoverA = await settle()
ok('鼠标停在 solo 上时只有它高亮', byClass(hoverA, 'dsh-git-bs-row-on').length === 1 && textOf(byClass(hoverA, 'dsh-git-bs-row-on')[0]).indexOf('solo') >= 0)

const skipsBeforeHover = memoSkips
enterRow(hoverA, 'zeta', 120)
await wait(20)
const hoverB = await settle()
ok('高亮跟着鼠标换到 zeta', byClass(hoverB, 'dsh-git-bs-row-on').length === 1 && textOf(byClass(hoverB, 'dsh-git-bs-row-on')[0]).indexOf('zeta') >= 0)
ok('换行时 memo 跳过了其余分支行', memoSkips > skipsBeforeHover)

/* 记忆的行要跟着状态走：收藏一颗星，只有那一行该变 */
const star = buttons(rowWith(hoverB, 'zeta')).find((b) => String(b.props.className).indexOf('dsh-git-bs-star') >= 0)
star.props.onClick({ stopPropagation() {}, preventDefault() {} })
await wait(20)
const starred = await settle()
ok('收藏后只有该行亮起星标', byClass(starred, 'dsh-git-bs-star-on').length === 1 && byClass(rowWith(starred, 'zeta'), 'dsh-git-bs-star-on').length === 1)

/* 记忆的行也要跟着筛选走：列表变了，内容必须跟着变 */
const filter = inputs(starred).find((n) => n.props.className !== undefined && String(n.props.className).indexOf('dsh-git-bs-search') >= 0)
filter.props.onChange({ target: { value: 'feature' } })
await wait(20)
const filtered = await settle()
ok('筛选后只剩匹配的分支', branchRows(filtered).length === 1 && textOf(branchRows(filtered)[0]).indexOf('feature/one') >= 0)

/* ── 5. Host 还没注册好时自动重试 ── */

console.log('')
console.log('== Host 未就绪时的重试 ==')

/* 只有「is not registered」值得重试：那是 Host 半侧还没读完自己的源码，
   调用根本没到处理器。别的错误一次就结束。 */
const firePendingTimeouts = async function () {
  const pending = timers.filter((t) => t.kind === 'timeout' && t.dead !== true)
  for (const t of pending) { t.dead = true; t.cb() }
  await wait(5)
}

/* 回到「200 个提交 + 有视口」的状态：这时行数才有意义 */
graphCommits = many
fakeNode.clientHeight = 600
fakeNode.scrollTop = 0

const plainCall2 = host.call
let refusals = 0
host.call = function (method, args) {
  if (method === 'git/graph' && refusals < 2) {
    refusals += 1
    calls.push({ method, args })
    return Promise.reject(new Error('host.call("git/graph") on dshgit-3 is not registered: the host half must declare it with harness.handle("git/graph", fn).'))
  }
  return plainCall2.call(host, method, args)
}

byClass(filtered, 'dsh-git-lf-select')[1].props.onChange({ target: { value: 'mays@example.com' } })
await wait(10)
await settle()                                   /* 效果跑起来，第一次被拒 */
for (let i = 0; i < 3; i += 1) await firePendingTimeouts()   /* 重试定时器：第二次被拒，第三次成功 */
await wait(20)
const retried = await settle()
ok('Host 尚未注册时被拒绝，随后自动重试成功', refusals === 2)
ok('重试之后拿到的是这一轮的数据', crow(retried).length === 32 && textOf(retried).indexOf('commit 5') >= 0)

/* 别的错误不重试：一次就报错，不拖满 24 次 */
const plainCall3 = host.call
let hardFailures = 0
host.call = function (method, args) {
  if (method === 'git/graph') {
    hardFailures += 1
    return Promise.reject(new Error('boom'))
  }
  return plainCall3.call(host, method, args)
}
byClass(retried, 'dsh-git-lf-select')[1].props.onChange({ target: { value: '' } })
await wait(30)
await settle()
ok('普通错误一次就结束，不会反复重试', hardFailures === 1)
host.call = plainCall3
