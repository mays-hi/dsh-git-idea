
/* ── 在终端/IDEA 里自己切了分支，对话框上的 chip 会跟着变吗？──

   主机侧「签名里必须能看出换了分支」由 gp34a 用真 git 证明（外部 `git switch`
   之后 `git/watch` 的签名确实不同）。这一节接上后半段：签名变了以后，chip 到底
   有没有重读、有没有换名字，以及什么时候它根本不该读。 */

const realCall = host.call
let watchSig = 'SIG-A'
host.call = function (method, args) {
  if (method === 'git/watch') {
    calls.push({ method: method, args: args })
    return Promise.resolve({ ok: true, repo: '/tmp/ws', sig: watchSig })
  }
  return realCall(method, args)
}

const labelOf = (tree) => {
  const span = byClass(tree, 'dsh-git-chip-label')[0]
  return span === undefined ? '' : textOf(span)
}
const lanes = () => timers.filter((t) => t.kind === 'interval' && t.dead !== true)
const tick = () => lanes().forEach((t) => t.cb())
const since = (mark) => calls.slice(mark)
const methodsSince = (mark) => since(mark).map((c) => c.method)

console.log('')
console.log('=== 手动切分支之前：chip 的轮询长什么样 ===')
const first = await chipTree()
ok('chip 显示当前分支 main', labelOf(first) === 'main')
ok('chip 自己注册了一个轮询', lanes().length === 1)
ok('没有面板时走慢车道（15 秒）', lanes()[0].delay === 15000)

let mark = calls.length
tick()
await wait(30)
const watchArgs = since(mark).filter((c) => c.method === 'git/watch').map((c) => c.args)
ok('第一次轮询只记下签名，不白读一遍数据', methodsSince(mark).indexOf('git/panel') < 0)
ok('轮询问的是廉价签名，不带 deep（慢盘上 deep 是秒级）',
  watchArgs.length === 1 && watchArgs[0].deep === undefined && watchArgs[0].sessionId === 's-1')

console.log('')
console.log('=== 外面切了分支：签名变了 ===')
mark = calls.length
watchSig = 'SIG-B'
OK_PANEL.branch = 'release/2.0'
tick()
await wait(30)
const moved = await chipTree()
ok('签名变了 → chip 换成新分支 release/2.0', labelOf(moved) === 'release/2.0')
const seq = methodsSince(mark)
ok('先 flush 主机缓存，再重读（否则读到的还是缓存里的旧分支）',
  seq.indexOf('git/flush') >= 0 && seq.indexOf('git/flush') < seq.indexOf('git/panel'))
ok('重读走的是先便宜后完整那两段，不是一整条状态读',
  seq.filter((m) => m === 'git/panel').length === 2)

console.log('')
console.log('=== 签名没变：一次都不该读 ===')
mark = calls.length
tick()
await wait(30)
tick()
await wait(30)
ok('仓库没动就不重读（不会每 15 秒白读一次）', methodsSince(mark).indexOf('git/panel') < 0)
ok('没动的时候 flush 也不会发', methodsSince(mark).indexOf('git/flush') < 0)

console.log('')
console.log('=== 面板打开之后：同一个仓库改成快车道 ===')
await openPanel()
const after = lanes().map((t) => t.delay).sort((a, b) => a - b)
console.log('  活跃轮询间隔：', after.join('ms, ') + 'ms')
ok('面板一开，这个仓库上就多出一条 3 秒的快车道', after.indexOf(3000) >= 0)
mark = calls.length
watchSig = 'SIG-C'
OK_PANEL.branch = 'main'
tick()
await wait(40)
const back = await settle()
ok('面板开着时切回去，chip 与面板同时跟上', labelOf(await chipTree()) === 'main' && textOf(back).indexOf('main') >= 0)
ok('快车道那一次也仍然先 flush', methodsSince(mark).indexOf('git/flush') >= 0)

console.log('')
console.log('=== 页面被切到后台，再切回来 ===')
fakeDoc.hidden = true
mark = calls.length
tick()
await wait(30)
ok('页面在后台时不轮询', methodsSince(mark).indexOf('git/watch') < 0)
watchSig = 'SIG-D'
OK_PANEL.branch = 'release/3.1'
fakeDoc.hidden = false
mark = calls.length
fakeDoc.fire('visibilitychange')
await wait(40)
ok('切回页面立刻对一次签名，不用等下一个间隔', methodsSince(mark).indexOf('git/watch') >= 0)
ok('对完发现仓库动了，chip 立刻跟上', labelOf(await chipTree()) === 'release/3.1')
mark = calls.length
fakeDoc.fire('visibilitychange')
await wait(40)
ok('仓库没动时切回来也不会白读一遍', methodsSince(mark).indexOf('git/panel') < 0)

/* ── chip 上的未提交数量：便宜的第一次读回来时不能消失 ──

   面板与 chip 都是两段读：先 0.15 秒的身份读（`partial`，**不带工作区**），
   再 7 秒的完整读。把 `partial` 的「没有改动列表」当成「没有改动」，就会在
   每次仓库动过之后把徽标抹掉，几秒后才补回来 —— 用户看到的就是「数量消失，
   过一会才出来」。这一节盯住那个瞬间。 */

console.log('')
console.log('=== 轮询之后，未提交数量不许先消失 ===')
const beforePanel = host.call
let fullPending = 3
let fullGate = null
const panelCalls = []
host.call = function (method, args) {
  if (method === 'git/panel') {
    panelCalls.push(args)
    const head = { ok: true, repo: '/tmp/ws', branch: 'main', detached: false, upstream: 'origin/main', ahead: 0, behind: 0, sequencer: null }
    if (args != null && args.quick === true) {
      return Promise.resolve(Object.assign({ partial: true, staged: [], unstaged: [], untracked: [], unmerged: [] }, head))
    }
    const items = []
    for (let i = 0; i < fullPending; i += 1) items.push({ path: 'f' + i + '.txt', code: ' M' })
    const reply = Object.assign({ staged: [], unstaged: items, untracked: [], unmerged: [] }, head)
    if (fullGate !== null) return new Promise(function (resolve) { fullGate = resolve.bind(null, reply) })
    return Promise.resolve(reply)
  }
  return beforePanel(method, args)
}
const badgeOf = (tree) => byClass(tree, 'dsh-git-badge')
const badgeText = (tree) => (badgeOf(tree)[0] === undefined ? '' : textOf(badgeOf(tree)[0]))
const badgeClass = (tree) => (badgeOf(tree)[0] === undefined ? '' : String(badgeOf(tree)[0].props.className))

const s2 = await renderUntilStable(makeElement(chip, { sessionId: 's-2' }), 'chip-s2')
ok('第一次完整读之后徽标显示 3', badgeText(s2) === '3' && !/stale/.test(badgeClass(s2)))

watchSig = 'SIG-E'
/* 把完整读按住，才看得见中间那一刻 —— 在真机上那一段是 7 秒，在测试里是 0 微秒 */
fullGate = true
tick()
await wait(40)
const during = await renderUntilStable(makeElement(chip, { sessionId: 's-2' }), 'chip-s2')
ok('便宜的第一次读回来后徽标还在，没有先掉到 0', badgeText(during) === '3')
ok('但它被标成「还没核对」（半透明）', /dsh-git-badge-stale/.test(badgeClass(during)))
ok('tooltip 说的是正在核对，不会谎称工作区干净',
  String(during.props.title).indexOf('正在核对') >= 0)

const release2 = fullGate
fullGate = null
release2()
await wait(40)
const settled3 = await renderUntilStable(makeElement(chip, { sessionId: 's-2' }), 'chip-s2')
ok('完整读回来之后同一个数字转正（去掉半透明）', badgeText(settled3) === '3' && !/stale/.test(badgeClass(settled3)))

/* 换会话：这个会话是第一次来，自己的完整读还没回来 */
fullGate = true
watchSig = 'SIG-F'
const s3 = await renderUntilStable(makeElement(chip, { sessionId: 's-3' }), 'chip-s3')
ok('新会话的第一眼就带着这个仓库上次的数字（不空着）', badgeText(s3) === '3')
ok('而且是「还没核对」的样子', /dsh-git-badge-stale/.test(badgeClass(s3)))
const release = fullGate
fullGate = null
release()
await wait(40)
const s3done = await renderUntilStable(makeElement(chip, { sessionId: 's-3' }), 'chip-s3')
ok('它自己的完整读回来后就转正了', badgeText(s3done) === '3' && !/stale/.test(badgeClass(s3done)))

/* 提交干净之后：数字该变成「没有徽标」，而且不再是核对中的样子 */
fullPending = 0
watchSig = 'SIG-G'
tick()
await wait(60)
const clean = await renderUntilStable(makeElement(chip, { sessionId: 's-3' }), 'chip-s3')
ok('改动清零后徽标消失', badgeOf(clean).length === 0)
ok('tooltip 这时才说工作区干净', String(clean.props.title).indexOf('工作区干净') >= 0)
