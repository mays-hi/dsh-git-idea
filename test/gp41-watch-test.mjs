import fs from 'node:fs'

/* ── the miniature React again (the restart emptied /tmp) ── */

const store = {}
const fakeDoc = {
  defaultView: {
    innerWidth: 1400, innerHeight: 900,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v) },
    },
  },
  _listeners: {},
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f) },
  removeEventListener(t, f) { this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== f) },
  fire(t, e) { (this._listeners[t] || []).slice().forEach((f) => f(e)) },
}
const INSIDE = { nodeType: 1, name: 'inside-panel' }
const IN_CARD = { nodeType: 1, name: 'inside-switcher-card' }
const IN_CHIP = { nodeType: 1, name: 'inside-composer-chip' }
const OUTSIDE = { nodeType: 1, name: 'outside' }
const fakeNode = { ownerDocument: fakeDoc, offsetWidth: 900, offsetHeight: 600, contains: () => false }
/* 每个容器一个独立节点，才能区分「点在面板里」和「点在浮层卡片里」 */
const panelNodeObj = { ownerDocument: fakeDoc, offsetWidth: 900, offsetHeight: 600, contains: (t) => t === INSIDE || t === IN_CARD }
const cardNodeObj = { ownerDocument: fakeDoc, offsetWidth: 340, offsetHeight: 300, contains: (t) => t === IN_CARD }
const chipNodeObj = { ownerDocument: fakeDoc, contains: (t) => t === IN_CHIP }
const timers = []
const fibers = new Map()
let currentFiber = null
let dirty = false

function makeElement(type, props, ...children) {
  const flat = []
  const push = (c) => {
    if (c === null || c === undefined || c === false || c === true) return
    if (Array.isArray(c)) { c.forEach(push); return }
    flat.push(c)
  }
  children.forEach(push)
  const merged = Object.assign({}, props)
  merged.children = flat
  return { type: type, key: merged.key === undefined ? null : merged.key, props: merged }
}
/* memo：真实 React 会跳过 props 没变的子树，基准与断言都应该能看到这件事 */
const memoCache = new Map()
let memoSkips = 0
function shallowSame(a, b) {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) { if (k === 'children') continue; if (a[k] !== b[k]) return false }
  return true
}
const React = {
  createElement: makeElement,
  memo(component) { return { $$memo: true, render: component } },
  /* useCallback 按依赖记忆，和真实 React 一样：否则 memo 永远命中不了，
     基准和断言也就看不到「行级记忆」到底有没有生效 */
  useCallback(fn, deps) {
    const fiber = currentFiber
    const index = fiber.cursor
    fiber.cursor += 1
    const previous = fiber.memos === undefined ? undefined : fiber.memos[index]
    if (previous !== undefined && Array.isArray(deps) && Array.isArray(previous.deps)
      && deps.length === previous.deps.length && deps.every((d, i) => d === previous.deps[i])) return previous.fn
    if (fiber.memos === undefined) fiber.memos = []
    fiber.memos[index] = { deps: deps, fn: fn }
    return fn
  },
  useMemo(factory) { return factory() },
  useState(initial) {
    const fiber = currentFiber
    const index = fiber.cursor
    fiber.cursor += 1
    if (fiber.hooks.length <= index) fiber.hooks[index] = typeof initial === 'function' ? initial() : initial
    const setter = (next) => {
      const value = typeof next === 'function' ? next(fiber.hooks[index]) : next
      if (fiber.hooks[index] !== value) { fiber.hooks[index] = value; dirty = true }
    }
    return [fiber.hooks[index], setter]
  },
  useEffect(effect, deps) {
    const fiber = currentFiber
    const index = fiber.cursor
    fiber.cursor += 1
    const previous = fiber.effects[index]
    const same = previous !== undefined && Array.isArray(deps) && Array.isArray(previous.deps)
      && deps.length === previous.deps.length && deps.every((d, i) => d === previous.deps[i])
    if (same) return
    if (previous !== undefined && typeof previous.cleanup === 'function') previous.cleanup()
    fiber.effects[index] = { deps: deps, cleanup: undefined }
    fiber.pending.push(() => {
      const cleanup = effect()
      fiber.effects[index].cleanup = typeof cleanup === 'function' ? cleanup : undefined
    })
  },
}
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node.props === undefined) return ''
  return textOf(node.props.children)
}
function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((c) => walk(c, visit)); return }
  visit(node)
  const kids = node.props !== undefined && Array.isArray(node.props.children) ? node.props.children : []
  kids.forEach((c) => walk(c, visit))
}
function collect(node, out = []) {
  if (node == null || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((c) => collect(c, out)); return out }
  out.push(node)
  const k = node.props && node.props.children
  if (Array.isArray(k)) k.forEach((c) => collect(c, out))
  return out
}
const buttons = (t) => collect(t).filter((n) => n.type === 'button')
const inputs = (t) => collect(t).filter((n) => n.type === 'input')
const byClass = (t, s) => collect(t).filter((n) => typeof n.props.className === 'string' && n.props.className.split(' ').indexOf(s) >= 0)
const rows = (t) => byClass(t, 'dsh-git-bs-row')
/* 操作行与分支行共用 .dsh-git-bs-row，取分支行时要排掉操作行 */
const branchRows = (t) => rows(t).filter((r) => String(r.props.className).indexOf('dsh-git-bs-action') < 0)
const rowWith = (t, label) => branchRows(t).find((r) => textOf(r).indexOf(label) >= 0)
const groups = (t) => byClass(t, 'dsh-git-bs-group')

function renderRoot(element, label) {
  const pending = []
  const render = (node, path) => {
    if (node === null || node === undefined) return null
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return node.map((c, i) => render(c, path + '.' + i))
    const type = node.type
    if (type != null && typeof type === 'object' && type.$$memo === true) {
      const memoKey = path + '#' + (type.render.name || 'memo')
      const previous = memoCache.get(memoKey)
      if (previous !== undefined && shallowSame(previous.props, node.props)) {
        memoSkips += 1
        return previous.tree
      }
      const tree = render({ type: type.render, props: node.props, key: node.key, props2: null }, path)
      memoCache.set(memoKey, { props: node.props, tree: tree })
      return tree
    }
    if (typeof type !== 'function') {
      const kids = (node.props.children || []).map((c, i) => render(c, path + '/' + i))
      const out = { type: type, key: node.key, props: Object.assign({}, node.props, { children: kids }) }
      if (typeof node.props.ref === 'function') {
        const cls = String(node.props.className || '')
        let target = fakeNode
        if (cls.indexOf('dsh-git-switch') >= 0) target = cardNodeObj
        else if (cls.indexOf('dsh-git-pop') >= 0) target = panelNodeObj
        else if (cls.indexOf('dsh-git-chip') >= 0) target = chipNodeObj
        if (target !== fakeNode && !globalThis.__seen) globalThis.__seen = new Set()
        if (target !== fakeNode && !globalThis.__seen.has(cls)) { globalThis.__seen.add(cls); console.log('  [ref→' + (target === panelNodeObj ? 'panel' : target === cardNodeObj ? 'card' : 'chip') + '] className=' + JSON.stringify(cls)) }
        node.props.ref(target)
      }
      return out
    }
    const fiberKey = path + '#' + (type.name || 'anon') + '#' + (node.key === null ? '' : node.key)
    let fiber = fibers.get(fiberKey)
    if (fiber === undefined) { fiber = { hooks: [], memos: [], effects: [], cursor: 0, pending: [] }; fibers.set(fiberKey, fiber) }
    fiber.cursor = 0
    fiber.pending = []
    const previous = currentFiber
    currentFiber = fiber
    let out
    try { out = type(node.props) } finally { currentFiber = previous }
    pending.push(fiber)
    return render(out, path + '/' + (type.name || 'anon'))
  }
  const tree = render(element, label)
  for (const fiber of pending) for (const job of fiber.pending.splice(0)) job()
  return tree
}
async function renderUntilStable(element, label) {
  let tree = null
  for (let i = 0; i < 40; i += 1) {
    dirty = false
    tree = renderRoot(element, label)
    await new Promise((r) => setTimeout(r, 0))
    if (!dirty) return tree
  }
  throw new Error('render did not settle for ' + label)
}

/* ── mocks ── */

const calls = []
const nowSec = Math.floor(Date.now() / 1000)
const OK_PANEL = { ok: true, repo: '/tmp/ws', branch: 'main', detached: false, upstream: 'origin/main', ahead: 2, behind: 1, sequencer: null, staged: [], unstaged: [], untracked: [], unmerged: [] }
const branchesReply = {
  ok: true, repo: '/tmp/ws', current: 'main', previous: 'solo',
  branches: [
    { name: 'main', current: true, committedAt: nowSec - 5, upstream: 'origin/main', track: '=', ahead: 2, behind: 1, head: 'aaa', subject: 'tip main' },
    { name: 'solo', current: false, committedAt: nowSec - 3600, upstream: '', track: '', ahead: 0, behind: 0, head: 'bbb', subject: 'solo tip' },
    { name: 'feature/one', current: false, committedAt: nowSec - 90000, upstream: 'origin/feature/one', track: '>', ahead: 1, behind: 0, head: 'ccc', subject: 'one tip' },
    { name: 'zeta', current: false, committedAt: nowSec - 9000, upstream: '', track: '', ahead: 0, behind: 0, head: 'ddd', subject: 'z' },
  ],
  remotes: [{ name: 'remote-only', remote: 'origin', ref: 'origin/remote-only', committedAt: nowSec - 500, head: 'eee', subject: 'r' }],
}
let checkoutReply = { ok: true, repo: '/tmp/ws', stashed: false, dirty: 0, popConflict: false, stdout: '', stderr: '', exitCode: 0 }
const host = {
  call(method, args) {
    calls.push({ method, args })
    if (method === 'git/panel') return Promise.resolve(OK_PANEL)
    if (method === 'git/branches') return Promise.resolve(branchesReply)
    if (method === 'git/refs') return Promise.resolve({ ok: true, repo: '/tmp/ws', current: ['main'], local: [{ segments: ['main'], data: 'main' }, { segments: ['feature'], data: 'feature' }, { segments: ['stable'], data: 'stable' }], remote: [] })
    if (method === 'git/authors') return Promise.resolve({
      ok: true, repo: '/tmp/ws',
      authors: [
        { name: 'mays', email: 'mays@example.com', count: 12 },
        { name: 'jiangzx', email: 'jiangzx@example.com', count: 30 },
      ],
    })
    /* the graph echoes the ref it was asked for, so the scope is visible in the
       reply as well as in the request the test records */
    if (method === 'git/graph') return Promise.resolve({ ok: true, repo: '/tmp/ws', ref: (args && args.ref) || (args && args.allRefs === true ? '' : 'main'), currentBranch: 'main', commits: graphCommits, rows: [], lanes: 1 })
    if (method === 'git/watch') return Promise.resolve({ ok: true, repo: '/tmp/ws', sig: 'SIG' })
    if (method === 'git/commit-detail') return Promise.resolve({ ok: true, repo: '/tmp/ws', hash: (args && args.hash) || 'a', subject: 'detail subject', body: '', author: 'mays', date: '2026-09-16', files: [], branches: [] })
    if (method === 'git/flush') return Promise.resolve({ ok: true })
    if (method === 'git/config') return Promise.resolve({ ok: true, path: '/home/u/.dsh/dsh-git-idea.json', config: { initBranch: 'main', cherryPickRecord: false } })
    if (method === 'git/checkout') return Promise.resolve(checkoutReply)
    return Promise.resolve({ ok: true, repo: '/tmp/ws', stdout: '', stderr: '', exitCode: 0 })
  },
}
/* the history the mock hands back; a test may swap it to simulate a re-read */
let graphCommits = [
  { hash: 'aaa111', subject: 'tip commit', author: 'mays', date: '2026-09-16', committedAt: nowSec - 60, refs: ['HEAD -> dev'] },
  { hash: 'bbb222', subject: 'second commit', author: 'mays', date: '2026-09-15', committedAt: nowSec - 3600, refs: [] },
  { hash: 'ccc333', subject: 'third commit', author: 'jiangzx', date: '2026-09-14', committedAt: nowSec - 7200, refs: [] },
]
const registered = []
const slots = { inject: (k, cb) => cb(), register: (o, c) => { registered.push({ options: o, component: c }); return () => {} } }
const ctx = {
  get(n) {
    if (n === 'slots') return slots
    if (n === 'timer') return {
      interval(cb, delay) { const t = { kind: 'interval', cb, delay, dead: false }; timers.push(t); return () => { t.dead = true } },
      timeout(cb, delay) { const t = { kind: 'timeout', cb, delay, dead: false }; timers.push(t); return () => { t.dead = true } },
    }
    return undefined
  },
  effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
}
const styles = { insert: () => () => {} }
new Function('ctx', 'React', 'host', 'styles', 'console', fs.readFileSync(process.env.GP_SRC || new URL('../client.js', import.meta.url).pathname, 'utf8'))(
  ctx, React, host, styles, console).apply(ctx)

const chip = registered.find((r) => r.options.id === 'dsh-git-idea-chip').component
const popover = registered.find((r) => r.options.id === 'dsh-git-idea-panel').component
const section = registered.find((r) => r.options.id === 'dsh-git-idea').component

const wait = (ms) => new Promise((r) => setTimeout(r, ms || 10))
const popTree = (l) => renderUntilStable(makeElement(popover, { sessionId: 's-1' }), l || 'pop')
const chipTree = (l) => renderUntilStable(makeElement(chip, { sessionId: 's-1' }), l || 'chip')
async function settle(l) { let t = null; for (let i = 0; i < 4; i += 1) { t = await popTree(l); await wait(10) } return t }
async function openPanel() {
  let t = await chipTree()
  if (t.props.className.indexOf('dsh-git-chip-open') < 0) { t.props.onClick(); await wait(10) }
  return await settle()
}
async function openSwitcher() {
  const t = await openPanel()
  const chipBtn = byClass(t, 'dsh-git-branch-chip')[0]
  chipBtn.props.onClick()
  await wait(10)
  return await settle()
}

const ok = (label, value) => console.log('  ' + (value ? '✓' : '✗') + ' ' + label + (value ? '' : '   ← 不符合预期'))

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
