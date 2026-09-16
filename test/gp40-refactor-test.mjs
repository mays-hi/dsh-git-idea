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
/* 第一个勾选框属于「插件配置」（写进 Host 的配置文件），本浏览器的设置从第二个开始。
   挑最后一个（悬停切换）来拨：它不影响后面的用例，而 watchEnabled 关掉的话
   整个套件后半段都不会再有轮询了。 */
const localBoxes = inputs(settingsTree).filter((n) => n.props.type === 'checkbox')
localBoxes[localBoxes.length - 1].props.onChange({ target: { checked: false } })
await wait(10)
const savedSettings = JSON.parse(store['dsh.git-idea.settings'])
ok('设置写进 dsh.git-idea.settings', savedSettings.hoverSwitch === false)
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

/* ── 6. IDEA 式布局 ── */

console.log('')
console.log('== IDEA 式布局 ==')

/* 回到干净状态：200 个提交、没有筛选 */
host.call = plainCall2
byClass(await settle(), 'dsh-git-lf-select')[1].props.onChange({ target: { value: '' } })
await wait(20)
let idea = await settle()

const pick = (tree, cls) => collect(tree).filter((n) => typeof n.props.className === 'string' && n.props.className.split(' ').indexOf(cls) >= 0)
const sideSearch = inputs(idea).find((n) => String(n.props.className).indexOf('dsh-git-sidehead-input') >= 0)
ok('左栏顶上多了一个搜索框', sideSearch !== undefined && sideSearch.props.placeholder === '搜索分支')
ok('左栏默认列出全部分支', pick(idea, 'dsh-git-tname').map(textOf).join(',').indexOf('feature') >= 0)

sideSearch.props.onChange({ target: { value: 'fea' } })
await wait(10)
const filteredTree = await settle()
const namesNow = pick(filteredTree, 'dsh-git-tname').map(textOf)
ok('搜分支后只剩匹配的行', namesNow.join(',').indexOf('feature') >= 0 && namesNow.join(',').indexOf('stable') < 0)
ok('分组标题仍然在，条数是过滤后的', pick(filteredTree, 'dsh-git-tdim').map(textOf).indexOf('1') >= 0)

const sideClear = buttons(filteredTree).find((b) => String(b.props.className).indexOf('dsh-git-sidehead-x') >= 0)
ok('搜索框带清除按钮', sideClear !== undefined)
sideClear.props.onClick()
await wait(10)
const cleared = await settle()
ok('清除后分支又都回来了', pick(cleared, 'dsh-git-tname').map(textOf).join(',').indexOf('stable') >= 0)

/* 工具栏：筛选在左、提交操作在右，中间夹着 IDEA 的 .* 和 Cc */
const bar = byClass(cleared, 'dsh-git-tools')[0]
const nodes = collect(bar)
const indexOfClass = (cls) => nodes.findIndex((n) => typeof n.props.className === 'string' && n.props.className.split(' ').indexOf(cls) >= 0)
ok('搜索框在最前，提交操作最后（IDEA 的顺序）', indexOfClass('dsh-git-logsearch') < indexOfClass('dsh-git-lf') && indexOfClass('dsh-git-lf') < indexOfClass('dsh-git-tool-ico'))
const flags = pick(bar, 'dsh-git-lf-flag')
const flagOn = (b) => String(b.props.className).indexOf('dsh-git-lf-on') >= 0
ok('搜索框旁边是 .* 和 Cc 两个开关', flags.length === 2 && textOf(flags[0]) === '.*' && textOf(flags[1]) === 'Cc')
ok('两个开关默认都是关的（搜索行为不变）', flagOn(flags[0]) === false && flagOn(flags[1]) === false)

/* 先给搜索框一个词：没有搜索词的时候这两个开关没有意义，请求里也就不带 */
inputs(cleared).find((n) => String(n.props.className).indexOf('dsh-git-logsearch-input') >= 0)
  .props.onKeyDown({ key: 'Enter', preventDefault() {} })
await wait(10)
byClass(await settle(), 'dsh-git-logsearch-input')[0].props.onChange({ target: { value: 'tip' } })
byClass(await settle(), 'dsh-git-logsearch-input')[0].props.onKeyDown({ key: 'Enter', preventDefault() {} })
await wait(20)
const searched = await settle()

const graphCalls = () => calls.filter((c) => c.method === 'git/graph')
calls.length = 0
pick(searched, 'dsh-git-lf-flag')[0].props.onClick()
await wait(20)
const withRegex = await settle()
const lastAsk = graphCalls().pop()
ok('打开 .* 之后请求带上 regex，而且搜索词还在', lastAsk !== undefined && lastAsk.args.regex === true && lastAsk.args.search === 'tip' && lastAsk.args.caseSensitive === undefined)

calls.length = 0
pick(withRegex, 'dsh-git-lf-flag')[1].props.onClick()
await wait(20)
await settle()
const lastAsk2 = graphCalls().pop()
ok('再打开 Cc 之后请求带上 caseSensitive', lastAsk2 !== undefined && lastAsk2.args.caseSensitive === true && lastAsk2.args.regex === true)

/* 选中那个提交在新的一份历史里不存在：重读之后选中被清掉，右栏回到空态 */
graphCommits = many.slice(0, 3)
pick(await settle(), 'dsh-git-lf-flag')[0].props.onClick()
await wait(20)
const noSelection = await settle()
const emptyPane = byClass(noSelection, 'dsh-git-detail-empty')
ok('右栏空态有自己的版式', emptyPane.length === 1 && textOf(emptyPane[0]).indexOf('选择一个提交') >= 0 && textOf(emptyPane[0]).indexOf('未选择提交') >= 0)

/* ── 7. 加载更多 + 面板分两段读 + 轮询按需加深 ── */

console.log('')
console.log('== 加载更多 / 分两段读 ==')

/* 比一页多的历史：260 条，第一页只能给 200 */
graphCommits = many.concat(many.slice(0, 60).map((c, i) => Object.assign({}, c, { hash: 'x' + String(i).padStart(6, '0') })))
const graphPage = function (args) {
  const want = args != null && typeof args.maxCount === 'number' ? args.maxCount : 200
  const slice = graphCommits.slice(0, want)
  return {
    ok: true, repo: '/tmp/ws', ref: 'main', currentBranch: 'main',
    commits: slice, rows: graphRows(slice), lanes: 1,
    hasMore: graphCommits.length > want, maxCount: want,
  }
}
host.call = function (method, args) {
  if (method !== 'git/graph') return plainCall2.call(host, method, args)
  calls.push({ method, args })
  return Promise.resolve(graphPage(args))
}
/* 触发一次重读：换个开关 */
pick(await settle(), 'dsh-git-lf-flag')[0].props.onClick()
await wait(20)
let paged = await settle()
ok('历史读到一页时列表底部给出「加载更多」', byClass(paged, 'dsh-git-more').length === 1 && textOf(byClass(paged, 'dsh-git-more')[0]).indexOf('已显示 200 条') >= 0)

calls.length = 0
buttons(byClass(paged, 'dsh-git-more')[0]).find((b) => textOf(b) === '加载更多').props.onClick()
await wait(20)
paged = await settle()
const asks = calls.filter((c) => c.method === 'git/graph')
ok('点它就去要更大的一页', asks.length >= 1 && asks[asks.length - 1].args.maxCount === 400)
ok('第二页把剩下的也要来了（列表长到 260 行），底部收起来',
  byClass(paged, 'dsh-git-more').length === 0
  && byClass(paged, 'dsh-git-logwrap')[0].props.style.minHeight === String(260 * ROW_H) + 'px')

/* 面板读工作区也是两段：先身份、后工作区 */
calls.length = 0
buttons(paged).find((b) => textOf(b) === '变更').props.onClick()
await wait(20)
const changesTab = await settle()
const panelAsks = calls.filter((c) => c.method === 'git/panel')
ok('切到变更页时先发便宜的身份读', panelAsks.length >= 1 && panelAsks[0].args.quick === true)

/* 轮询：历史页用便宜的签名，变更页才加深 */
buttons(changesTab).find((b) => textOf(b) === '历史').props.onClick()
await wait(20)
let logTab = await settle()
const tickIntervals = async () => {
  timers.filter((t) => t.kind === 'interval' && t.dead !== true).forEach((t) => t.cb())
  await wait(10)
}
const lastWatch = () => calls.filter((c) => c.method === 'git/watch').pop()
calls.length = 0
await tickIntervals()
const watchLog = lastWatch()
ok('历史页的轮询不带 deep', watchLog !== undefined && watchLog.args.deep === undefined)

calls.length = 0
buttons(logTab).find((b) => textOf(b) === '变更').props.onClick()
await wait(20)
const backToChanges = await settle()
await tickIntervals()
const watchChanges = lastWatch()
ok('变更页的轮询带 deep（要看工作区）', watchChanges !== undefined && watchChanges.args.deep === true)
buttons(backToChanges).find((b) => textOf(b) === '历史').props.onClick()
await wait(20)
await settle()
