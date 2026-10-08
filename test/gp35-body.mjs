/* ── 「打开面板要不要等」专用用例 ── */

let watchSig = 'SIG-1'
const baseCall = host.call
host.call = function (method, args) {
  if (method === 'git/watch') { calls.push({ method, args, tree: currentLabel }); return Promise.resolve({ ok: true, repo: '/tmp/ws', sig: watchSig }) }
  return baseCall(method, args)
}
/* 「面板的重读」= 不是芯片发的那次状态读 */
const heavy = () => calls.filter((c) => c.tree !== 'chip' && ['git/panel', 'git/refs', 'git/authors', 'git/graph', 'git/commit-detail'].indexOf(c.method) >= 0).map((c) => c.method)
const chipClose = async () => {
  const t = await chipTree()
  if (t.props.className.indexOf('dsh-git-chip-open') >= 0) { t.props.onClick(); await wait(10) }
  await settle('pop')
}
const tick = async () => {
  const iv = timers.filter((t) => t.kind === 'interval' && !t.dead)[0]
  iv.cb()
  await wait(25)
}

console.log('== 打开面板：第一次要读全，之后不该再读 ==')
fibers.clear()
calls.length = 0
let tree = await openPanel()
await wait(20)
console.log('  首次打开读了:', JSON.stringify(Array.from(new Set(calls.map((c) => c.method)))))
ok('首次打开拉了面板与历史', heavy().length >= 4)
ok('芯片顺带预取了分支列表（首帧就有数据）', calls.some((c) => c.method === 'git/branches'))
calls.length = 0
await settle('pop')
await wait(20)
ok('不动它时不再重读', calls.length === 0)

console.log('')
console.log('== 关掉面板后，仓库变化不再让隐藏面板重读 ==')
await chipClose()
await tick()
calls.length = 0
watchSig = 'SIG-2'
await tick()
console.log('  变化后发出的 RPC:', JSON.stringify(calls.map((c) => c.method)))
ok('确实发现了变化（问了 watch）', calls.some((c) => c.method === 'git/watch'))
ok('也把缓存清了', calls.some((c) => c.method === 'git/flush'))
ok('但隐藏面板没有重读历史', heavy().length === 0)

console.log('')
console.log('== 再打开：补一次，而且只补一次 ==')
calls.length = 0
tree = await openPanel()
await wait(30)
console.log('  打开时读了:', JSON.stringify(Array.from(new Set(calls.map((c) => c.method)))))
ok('打开时把欠的那次补上', heavy().length >= 4)
calls.length = 0
await settle('pop')
await wait(20)
ok('补完之后不再重复读', calls.length === 0)

console.log('')
console.log('== 没有任何变化时，关掉再打开应该是零成本 ==')
await chipClose()
calls.length = 0
tree = await openPanel()
await wait(30)
console.log('  无变化重开的 RPC:', JSON.stringify(calls.map((c) => c.method + ' @' + c.tree)))
ok('没有重读历史/分支/作者', heavy().length === 0)
/* 芯片发两次：先便宜的「哪个仓库哪个分支」，再补工作区状态（走缓存，0ms） */
const panelCalls = calls.filter((c) => c.method === 'git/panel')
ok('只有芯片自己那两次状态读（走缓存，0ms）',
  calls.length === 2 && panelCalls.length === 2 && calls.every((c) => c.tree === 'chip')
  && panelCalls.filter((c) => c.args.quick === true).length === 1)
ok('面板内容还在（标签页没丢）', textOf(tree).indexOf('历史') >= 0)

console.log('')
console.log('== 悬停卡片：先用记下来的列表画出来，同时在后台刷新 ==')
await chipClose()
fibers.clear()
calls.length = 0
const ct = await chipTree()
ct.props.onPointerEnter()
timers.filter((t) => t.kind === 'timeout' && !t.dead).forEach((t) => { t.dead = true; t.cb() })
await wait(15)
const card = await popTree()
ok('卡片出现', byClass(card, 'dsh-git-switch-hover').length === 1)
ok('首帧就有分支行（不是空列表）', branchRows(card).length > 0)
console.log('  卡片自己发的 RPC:', JSON.stringify(calls.map((c) => c.method)))
ok('同时还在后台刷新', calls.some((c) => c.method === 'git/branches'))

console.log('')
console.log('== 已经有缓存时，芯片不再重复预取 ==')
fibers.clear()
calls.length = 0
await chipTree()
await wait(40)
console.log('  芯片重挂载发出的 RPC:', JSON.stringify(calls.map((c) => c.method + ' ' + JSON.stringify(c.args))))
ok('不再重复预取分支列表', calls.filter((c) => c.method === 'git/branches').length === 0)
