
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
