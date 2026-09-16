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
const rows = (t) => byClass(t, 'gitops-bs-row')
/* 操作行与分支行共用 .gitops-bs-row，取分支行时要排掉操作行 */
const branchRows = (t) => rows(t).filter((r) => String(r.props.className).indexOf('gitops-bs-action') < 0)
const rowWith = (t, label) => branchRows(t).find((r) => textOf(r).indexOf(label) >= 0)
const groups = (t) => byClass(t, 'gitops-bs-group')

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
        if (cls.indexOf('gitops-switch') >= 0) target = cardNodeObj
        else if (cls.indexOf('gitops-pop') >= 0) target = panelNodeObj
        else if (cls.indexOf('gitops-chip') >= 0) target = chipNodeObj
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
    if (method === 'git/config') return Promise.resolve({ ok: true, path: '/home/u/.dsh/gitops.json', config: { initBranch: 'main', cherryPickRecord: false } })
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

const chip = registered.find((r) => r.options.id === 'gitops-git-chip').component
const popover = registered.find((r) => r.options.id === 'gitops-git-panel').component
const section = registered.find((r) => r.options.id === 'gitops').component

const wait = (ms) => new Promise((r) => setTimeout(r, ms || 10))
const popTree = (l) => renderUntilStable(makeElement(popover, { sessionId: 's-1' }), l || 'pop')
const chipTree = (l) => renderUntilStable(makeElement(chip, { sessionId: 's-1' }), l || 'chip')
async function settle(l) { let t = null; for (let i = 0; i < 4; i += 1) { t = await popTree(l); await wait(10) } return t }
async function openPanel() {
  let t = await chipTree()
  if (t.props.className.indexOf('gitops-chip-open') < 0) { t.props.onClick(); await wait(10) }
  return await settle()
}
async function openSwitcher() {
  const t = await openPanel()
  const chipBtn = byClass(t, 'gitops-branch-chip')[0]
  chipBtn.props.onClick()
  await wait(10)
  return await settle()
}

const ok = (label, value) => console.log('  ' + (value ? '✓' : '✗') + ' ' + label + (value ? '' : '   ← 不符合预期'))

/* ── IDEA 式子菜单：悬浮展开、离开收起、点 › 钉住 ── */

const fireTimers = () => {
  const live = timers.filter((t) => t.kind === 'timeout' && !t.dead)
  live.forEach((t) => { t.dead = true; t.cb() })
  return live.length
}
const flyPanel = (t) => byClass(t, 'gitops-bs-fly')[0]
const flyItems = (t) => {
  const fly = flyPanel(t)
  return fly === undefined ? [] : buttons(fly).map(textOf)
}
const flyHead = (t) => {
  const fly = flyPanel(t)
  return fly === undefined ? '' : textOf(byClass(fly, 'gitops-bs-fly-head')[0])
}
const listKids = (t) => {
  const list = byClass(t, 'gitops-bs-list')[0]
  return list === undefined ? 0 : (list.props.children || []).filter((c) => c != null && typeof c === 'object').length
}
const rowEnter = (t, name, top) => rowWith(t, name).props.onMouseEnter({ currentTarget: { offsetTop: top } })
const rowLeave = (t, name) => rowWith(t, name).props.onMouseLeave()

console.log('== 悬浮分支：子菜单出现在右侧，而不是把操作塞进列表 ==')
let t = await openSwitcher()
const kidsBefore = listKids(t)
ok('一开始没有子菜单', flyPanel(t) === undefined)
rowEnter(t, 'solo', 60)
await wait(10)
t = await settle('pop')
ok('悬浮先等一小会儿，不立刻弹（避免扫过列表时闪）', flyPanel(t) === undefined)
fireTimers()
await wait(10)
t = await settle('pop')
console.log('  子菜单 head:', JSON.stringify(flyHead(t)), ' 项:', JSON.stringify(flyItems(t)))
ok('延时到点后弹出子菜单', flyPanel(t) !== undefined)
ok('子菜单挂在列表之外（没有往列表里塞行）', listKids(t) === kidsBefore)
ok('子菜单标题是悬浮的那个分支', flyHead(t).indexOf('solo') >= 0)
ok('子菜单里是 IDEA 那套动作', flyItems(t).join('/') === '检出/从此分支新建分支…/合并到当前分支/删除')
ok('子菜单按行位置定位（offsetTop 60 → top 56px）', flyPanel(t).props.style.top === '56px')
ok('子菜单在卡片之内（点它不会被当成点外面）', byClass(t, 'gitops-bs').length === 1
  && collect(byClass(t, 'gitops-bs')[0]).indexOf(flyPanel(t)) >= 0)
ok('那一行被标成「子菜单属于我」', String(rowWith(t, 'solo').props.className).indexOf('gitops-bs-row-fly') >= 0)
ok('旧的整行操作条彻底没了', byClass(t, 'gitops-bs-acts').length === 0)

console.log('')
console.log('== 离开：先等一等，走进子菜单就取消关闭 ==')
rowLeave(t, 'solo')
await wait(5)
t = await settle('pop')
ok('刚离开还留着（给鼠标走向子菜单的时间）', flyPanel(t) !== undefined)
flyPanel(t).props.onPointerEnter()
fireTimers()
await wait(10)
t = await settle('pop')
ok('鼠标进了子菜单就不关了', flyPanel(t) !== undefined)
ok('进面板时把卡片自己的收起计时器也清掉了（不再有 200ms 的 hover 关闭在跑）',
  timers.filter((x) => x.kind === 'timeout' && !x.dead && x.delay === 200).length === 0)

/* 悬浮模式下卡片自己也有一个「离开就收起」的计时器：指针从行里走到面板上时，
   那个计时器也必须被取消，否则面板会在指针底下自己卸载，点击就落空了
   （这正是「点检出没反应」的成因，用模块级计时器的数量来验证）。 */
const hoverTimersBefore = () => timers.filter((x) => x.kind === 'timeout' && !x.dead && x.delay === 200).length
flyPanel(t).props.onPointerLeave()
fireTimers()
await wait(10)
t = await settle('pop')
ok('从子菜单离开后收起', flyPanel(t) === undefined)

console.log('')
console.log('== 悬浮卡片（hover 模式）：走到子菜单上不能把卡片弄没 ==')
/* 这一节复现用户报的「点检出没反应」：hover 模式的卡片自己有一个 pointerleave
   → 200ms 收起的计时器。指针从行里走到面板上时，只要那个计时器还在跑，卡片就会
   在指针底下卸载，点击落到空气上。 */
async function closePanel() {
  let t = await chipTree()
  if (t.props.className.indexOf('gitops-chip-open') >= 0) { t.props.onClick(); await wait(10) }
  return await chipTree()
}
await closePanel()
let chipTreeNow = await chipTree()
ok('面板已收起，卡片按钮是关的', chipTreeNow.props.className.indexOf('gitops-chip-open') < 0)
chipTreeNow.props.onPointerEnter()
fireTimers()
await wait(15)
let hover = await settle('pop')
ok('悬浮 chip 后出现 hover 卡片', byClass(hover, 'gitops-switch-hover').length === 1)
const hoverRows = byClass(hover, 'gitops-bs-row')
ok('hover 卡片里有分支行', hoverRows.length > 0)
hoverRows.find((r) => textOf(r).indexOf('solo') >= 0).props.onMouseEnter({ currentTarget: { offsetTop: 60 } })
fireTimers()
await wait(15)
hover = await settle('pop')
ok('hover 卡片里也弹出了子菜单', flyPanel(hover) !== undefined)
/* 模拟「指针离开卡片、然后进入子菜单」：卡片的收起计时器先安排上，子菜单的
   pointerenter 必须把它清掉。 */
byClass(hover, 'gitops-switch-hover')[0].props.onPointerLeave()
ok('离开卡片后有一个待收起的计时器', timers.filter((x) => x.kind === 'timeout' && !x.dead && x.delay === 200).length === 1)
flyPanel(hover).props.onPointerEnter()
ok('进入子菜单后那个计时器被清掉了', timers.filter((x) => x.kind === 'timeout' && !x.dead && x.delay === 200).length === 0)
fireTimers()
await wait(15)
hover = await settle('pop')
ok('因此卡片和子菜单都还在（点击才有落点）', byClass(hover, 'gitops-switch-hover').length === 1 && flyPanel(hover) !== undefined)
const hoverFly = flyPanel(hover)
ok('hover 卡片上的子菜单项可以点', buttons(hoverFly).length === 4)
calls.length = 0
buttons(hoverFly).find((b) => textOf(b) === '检出').props.onClick({ stopPropagation() {} })
await wait(15)
ok('点「检出」真的发出 git/checkout', calls.some((c) => c.method === 'git/checkout' && c.args.name === 'solo'))
checkoutReply = { ok: true, repo: '/tmp/ws', stashed: false, dirty: 0, popConflict: false, stdout: '', stderr: '', exitCode: 0 }

console.log('')
console.log('== 悬浮另一行会换成那一行的子菜单 ==')
t = await openSwitcher()
rowEnter(t, 'zeta', 120)
fireTimers()
await wait(10)
t = await settle('pop')
ok('换成了 zeta 的子菜单', flyHead(t).indexOf('zeta') >= 0)

console.log('')
console.log('== 点 › 钉住：鼠标移开也不收 ==')
const kidsNow = listKids(t)
const moreBtn = collect(rowWith(t, 'solo')).find((n) => typeof n.props.className === 'string' && n.props.className.indexOf('gitops-bs-more') >= 0)
moreBtn.props.onClick({ stopPropagation() {}, currentTarget: { offsetTop: 60 } })
fireTimers()
await wait(10)
t = await settle('pop')
ok('点 › 打开 solo 的子菜单', flyHead(t).indexOf('solo') >= 0)
rowLeave(t, 'solo')
fireTimers()
await wait(10)
t = await settle('pop')
ok('钉住之后鼠标移开也不收', flyPanel(t) !== undefined)
ok('钉住时不会把 list 撑高', listKids(t) === kidsNow)
const moreBtn2 = collect(rowWith(t, 'solo')).find((n) => typeof n.props.className === 'string' && n.props.className.indexOf('gitops-bs-more') >= 0)
moreBtn2.props.onClick({ stopPropagation() {}, currentTarget: { offsetTop: 60 } })
await wait(10)
t = await settle('pop')
ok('再点一次 › 收起', flyPanel(t) === undefined)

console.log('')
console.log('== 子菜单里的动作真的会发出去 ==')
rowEnter(t, 'solo', 60)
fireTimers()
await wait(10)
t = await settle('pop')
calls.length = 0
buttons(flyPanel(t)).find((b) => textOf(b) === '合并到当前分支').props.onClick({ stopPropagation() {} })
await wait(15)
ok('「合并到当前分支」发出 git/sequence merge', calls.some((c) => c.method === 'git/sequence' && c.args.op === 'merge' && c.args.target === 'solo'))
t = await settle('pop')
ok('执行后子菜单收起来', flyPanel(t) === undefined)

console.log('')
console.log('== 远端分支的子菜单 ==')
rowEnter(t, 'remote-only', 200)
fireTimers()
await wait(10)
t = await settle('pop')
console.log('  远端子菜单:', JSON.stringify(flyItems(t)))
ok('远端行给「检出为本地分支」', flyItems(t).indexOf('检出为本地分支') === 0)
ok('远端行不给删除', flyItems(t).every((i) => i.indexOf('删除') < 0))
ok('远端行也不给合并', flyItems(t).every((i) => i.indexOf('合并') < 0))

console.log('')
console.log('== 当前分支的子菜单 ==')
rowEnter(t, 'main', 20)
fireTimers()
await wait(10)
t = await settle('pop')
console.log('  当前分支子菜单:', JSON.stringify(flyItems(t)), ' head:', JSON.stringify(flyHead(t)))
ok('当前分支不给检出', flyItems(t).every((i) => i.indexOf('检出') < 0))
ok('当前分支不给删除', flyItems(t).every((i) => i.indexOf('删除') < 0))
ok('当前分支仍能从这里新建分支', flyItems(t).some((i) => i.indexOf('从此分支新建分支') >= 0))
ok('子菜单标题标出「当前」', flyHead(t).indexOf('当前') >= 0)

console.log('')
console.log('== 点当前分支那一行也能钉住 ==')
rowEnter(t, 'zeta', 90)
fireTimers()
await wait(10)
t = await settle('pop')
const mainRow = rowWith(t, 'main')
mainRow.props.onClick({ stopPropagation() {}, currentTarget: { offsetTop: 26 } })
await wait(10)
t = await settle('pop')
ok('点当前分支行打开了它自己的子菜单', flyHead(t).indexOf('main') >= 0)
const mainRow2 = rowWith(t, 'main')
mainRow2.props.onClick({ stopPropagation() {}, currentTarget: { offsetTop: 26 } })
await wait(10)
t = await settle('pop')
ok('再点一次收起', flyPanel(t) === undefined)
rowLeave(t, 'main')
fireTimers()
await wait(5)
t = await settle('pop')

console.log('')
console.log('== 滚动列表会收起子菜单（它锚在行的屏幕位置上）==')
rowEnter(t, 'zeta', 90)
fireTimers()
await wait(10)
t = await settle('pop')
ok('滚动前是开着的', flyPanel(t) !== undefined)
byClass(t, 'gitops-bs-list')[0].props.onScroll()
await wait(10)
t = await settle('pop')
ok('滚动后收起', flyPanel(t) === undefined)
