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

/* ── 左侧分支树：单击只选中，双击才联动中间的历史 ── */

/* 样式由 styles.insert 注入，测试里拿不到，预算要用的数字直接从源文件读 */
const sourceCss = fs.readFileSync(process.env.GP_SRC || new URL('../client.js', import.meta.url).pathname, 'utf8')

const treeRows = (t) => collect(t).filter((n) => typeof n.props.className === 'string' && n.props.className.split(' ').indexOf('dsh-git-trow') >= 0)
const trowWith = (t, label) => treeRows(t).find((n) => textOf(n) === label)
const graphCalls = () => calls.filter((c) => c.method === 'git/graph')
const lastGraph = () => graphCalls()[graphCalls().length - 1]

async function openLog() {
  const t = await openPanel()
  /* 面板默认在「历史」页 */
  return t
}

console.log('== 中间栏：IDEA 式一行筛选（不再有第二排输入框）==')
let t = await openLog()
console.log('  工具栏文本:', JSON.stringify(textOf(byClass(t, 'dsh-git-tools')[0])))
ok('工具栏只有一行', byClass(t, 'dsh-git-tools').length === 1)
ok('旧的第二排筛选框没了', byClass(t, 'dsh-git-filters').length === 0)
ok('旧的「筛选」开关按钮没了', buttons(byClass(t, 'dsh-git-tools')[0]).every((b) => textOf(b).indexOf('筛选') < 0))
ok('搜索框带放大镜', byClass(t, 'dsh-git-logsearch').length === 1 && byClass(t, 'dsh-git-logsearch-ico').length === 1)
ok('搜索框 placeholder 是「搜索提交信息…」', byClass(t, 'dsh-git-logsearch-input')[0].props.placeholder === '搜索提交信息…')
ok('四个筛选触发器都在（分支/作者/时间/路径）', byClass(t, 'dsh-git-lf').length === 4)
ok('分支筛选一直显示「分支：」', textOf(byClass(t, 'dsh-git-lf')[0]).indexOf('分支：') === 0)
ok('未设置时只显示字段名（作者/时间/路径）', byClass(t, 'dsh-git-lf').slice(1).map(textOf).join('|').indexOf('：') < 0)
ok('分支触发器用短标签（当前 main）', textOf(byClass(t, 'dsh-git-lf')[0]).indexOf('当前 main') > 0
  && textOf(byClass(t, 'dsh-git-lf')[0]).indexOf('当前分支（') < 0)
ok('筛选用的是无边框 select/input', byClass(t, 'dsh-git-lf-select').length === 3 && byClass(t, 'dsh-git-lf-input').length === 1)
/* 只看中间栏这条工具栏：面板头部那组同步按钮也是 .dsh-git-tool */
const toolBar = byClass(t, 'dsh-git-tools')[0]
const iconTools = byClass(toolBar, 'dsh-git-tool-ico')
console.log('  提交操作按钮:', JSON.stringify(iconTools.map((b) => b.props.title)))
ok('提交操作变成四个图标按钮', iconTools.length === 4 && byClass(toolBar, 'dsh-git-tool').length === 4)
ok('图标按钮各自带说明（拣选/还原/标签/分支）',
  ['拣选', '还原', '标签', '分支'].every((l) => iconTools.some((b) => String(b.props.title).indexOf(l) === 0)))
ok('图标按钮里画的是图标而不是文字', iconTools.every((b) => collect(b).some((n) => n.type === 'svg') && textOf(b) === ''))
const iconPaths = (btn) => collect(btn).filter((n) => n.type === 'svg')
  .map((n) => n.props.children.map((c) => String(c.props.d || '')).join('|')).join('||')
const shapes = iconTools.map(iconPaths)
ok('四个图标互不相同', shapes.filter((x, i) => shapes.indexOf(x) === i).length === 4)
ok('拣选不再是复制图标（复制是两个方框）', shapes[0].indexOf('H12.6') < 0 && shapes[0].indexOf('Z') < 0)
ok('拣选画的是樱桃（两个圆 + 果柄）', shapes[0].indexOf('A2.1 2.1') > 0 && shapes[0].indexOf('C 4.5 6.6') > 0)
ok('标签图标是带孔的标签形', shapes[2].indexOf('Z') > 0 && shapes[2].indexOf('A0.9 0.9') > 0)

console.log('')
console.log('== 中间这条工具栏：一行装得下，且筛选一多也不乱 ==')
const pxNum = (re) => {
  const m = sourceCss.match(re)
  return m === null ? -1 : Number(m[1])
}
const padRight = pxNum(/\.dsh-git-tools\{[^}]*padding:\d+px (\d+)px \d+px \d+px/)
const searchMax = pxNum(/\.dsh-git-logsearch\{[^}]*max-width:(\d+)px/)
const selectRule = (sourceCss.match(/\.dsh-git-lf-select\{[^}]*\}/) || [''])[0]
ok('工具条给右上角的条数留出了位置', padRight >= 70)
ok('条数绝对定位在右端（不会自己换到第二行）', /\.dsh-git-count\{[^}]*position:absolute/.test(sourceCss))
ok('搜索框不再是越大越好（上限收到 260 以内）', searchMax > 0 && searchMax <= 260)
ok('下拉不再写死宽度（改为按当前显示的值量宽）', selectRule.indexOf('max-width') < 0)

/* 具体到数字：把四个筛选都设上，量几个控件自己的宽度之和 */
const setFilter = async (i, value) => {
  byClass(t, 'dsh-git-lf-select')[i].props.onChange({ target: { value: value } })
  await wait(10)
  t = await settle('pop')
}
await setFilter(1, 'mays@example.com')
await setFilter(2, 'week')
byClass(t, 'dsh-git-lf-input')[0].props.onChange({ target: { value: 'src/main/java' } })
await wait(5)
t = await settle('pop')
byClass(t, 'dsh-git-lf-input')[0].props.onKeyDown({ key: 'Enter', preventDefault() {} })
await wait(10)
t = await settle('pop')
const trigW = byClass(t, 'dsh-git-lf-select').map((s) => Number(String(s.props.style.width).replace('px', '')))
const pathW = Number(String(byClass(t, 'dsh-git-lf-input')[0].props.style.width).replace('px', ''))
console.log('  触发器宽度:', JSON.stringify(trigW), ' 路径框:', pathW, ' 合计:', trigW.reduce((a, b) => a + b, 0) + pathW)
ok('四个筛选控件宽度之和 < 320px（选了条件也不会把行撑爆）', trigW.reduce((a, b) => a + b, 0) + pathW < 320)
ok('短值的下拉会缩到贴合文字（mays 不再是 112px 空框）', (function () {
  const authorSel = byClass(t, 'dsh-git-lf-select')[1]
  return Number(String(authorSel.props.style.width).replace('px', '')) < 60
})())
ok('长值也不会超过上限', trigW.every((w) => w <= 132))
/* 工具栏一行要装下的东西：4 个图标 + 分隔线 + 搜索框最小宽 + 四个触发器的
   标签前缀 + 它们各自的控件 + 条数预留的位置 + 间距 */
const chrome = 4 * 26 + 7 + 80 + (22 * 4) + 80 + 12 * 3
console.log('  固定部分:', chrome, 'px  控件:', trigW.reduce((a, b) => a + b, 0) + pathW, 'px')
ok('筛选全设上也只要 ~600px 出头（常见宽度下仍是一行）', chrome + trigW.reduce((a, b) => a + b, 0) + pathW < 660)

/* 收工：把筛选清掉，后面的用例假设没有筛选 */
await setFilter(1, '')
await setFilter(2, 'all')
byClass(t, 'dsh-git-lf-input')[0].props.onChange({ target: { value: '' } })
await wait(5)
t = await settle('pop')
byClass(t, 'dsh-git-lf-input')[0].props.onKeyDown({ key: 'Enter', preventDefault() {} })
await wait(10)
t = await settle('pop')
ok('收工后「全部清除」也跟着消失', byClass(t, 'dsh-git-lclear').length === 0)
ok('没有筛选时不显示「全部清除」', byClass(t, 'dsh-git-lclear').length === 0)

console.log('')
console.log('== 单击分支：只选中，不改中间的历史 ==')
t = await openLog()
const before = graphCalls().length
const featureRow = trowWith(t, 'feature')
ok('左侧树里有 feature 分支行', featureRow !== undefined)
featureRow.props.onClick()
await wait(15)
t = await settle('pop')
const afterClick = graphCalls().slice(before)
console.log('  单击后新增的 git/graph:', JSON.stringify(afterClick.map((c) => c.args.ref || (c.args.allRefs ? '@all' : 'main'))))
ok('单击没有重新读历史', afterClick.length === 0)
ok('单击选中了那一行', String(trowWith(t, 'feature').props.className).indexOf('dsh-git-trow-sel') >= 0)
ok('单击没有把它标成筛选范围', String(trowWith(t, 'feature').props.className).indexOf('dsh-git-trow-scope') < 0)
ok('单击给了「双击」提示', String(trowWith(t, 'feature').props.title).indexOf('双击') > 0)

console.log('')
console.log('== 双击分支：这才把历史切到它 ==')
trowWith(t, 'feature').props.onDoubleClick()
await wait(15)
t = await settle('pop')
console.log('  双击后的 git/graph:', JSON.stringify(graphCalls().slice(before).map((c) => c.args.ref || (c.args.allRefs ? '@all' : 'main'))))
ok('双击重新读了历史', graphCalls().length > before + 0 && lastGraph().args.ref === 'feature')
ok('双击后那一行标成筛选范围', String(trowWith(t, 'feature').props.className).indexOf('dsh-git-trow-scope') >= 0)
ok('双击后分支筛选触发器显示该分支', textOf(byClass(t, 'dsh-git-lf')[0]).indexOf('feature') > 0)
ok('别的分支没有被标成范围', String(trowWith(t, 'stable').props.className).indexOf('dsh-git-trow-scope') < 0)

console.log('')
console.log('== 每个筛选自己带 × 清除 ==')
const clearBranch = byClass(t, 'dsh-git-lf')[0].props.children.filter((c) => c != null && c.type === 'button')[0]
ok('分支筛选上有 ×', clearBranch !== undefined)
if (clearBranch !== undefined) {
  clearBranch.props.onClick({ stopPropagation() {} })
  await wait(15)
  t = await settle('pop')
  console.log('  清除分支范围后:', JSON.stringify(lastGraph().args))
  ok('× 之后回到默认范围（当前分支）', lastGraph().args.allRefs === undefined && lastGraph().args.ref === undefined)
}

console.log('')
console.log('== 作者 / 时间 / 路径三个触发器都会进 history 查询 ==')
const authorSelect = byClass(t, 'dsh-git-lf-select')[1]
authorSelect.props.onChange({ target: { value: 'mays@example.com' } })
await wait(15)
t = await settle('pop')
ok('选作者后 history 带上 author', lastGraph().args.author === 'mays@example.com')
ok('作者触发器变成「作者：」前缀', textOf(byClass(t, 'dsh-git-lf')[1]).indexOf('作者：') === 0)

const dateSelect = byClass(t, 'dsh-git-lf-select')[2]
dateSelect.props.onChange({ target: { value: 'week' } })
await wait(15)
t = await settle('pop')
ok('选时间后 history 带上 since', typeof lastGraph().args.since === 'string' && lastGraph().args.since.length > 0)
ok('时间触发器显示所选预设', textOf(byClass(t, 'dsh-git-lf')[2]).indexOf('最近 7 天') > 0)

const pathInput = byClass(t, 'dsh-git-lf-input')[0]
pathInput.props.onChange({ target: { value: 'src/main' } })
await wait(10)
t = await settle('pop')
byClass(t, 'dsh-git-lf-input')[0].props.onKeyDown({ key: 'Enter', preventDefault() {} })
await wait(15)
t = await settle('pop')
ok('路径回车后 history 带上 path', lastGraph().args.path === 'src/main')
ok('路径触发器加了「路径：」前缀', textOf(byClass(t, 'dsh-git-lf')[3]).indexOf('路径：') === 0)
ok('路径输入框里就是那个路径', byClass(t, 'dsh-git-lf-input')[0].props.value === 'src/main')
ok('此时才出现「全部清除」', byClass(t, 'dsh-git-lclear').length === 1)

const allClear = byClass(t, 'dsh-git-lclear')[0]
allClear.props.onClick()
await wait(15)
t = await settle('pop')
const after = lastGraph().args
console.log('  全部清除后的 git/graph:', JSON.stringify(after))
ok('全部清除撤掉 author/since/path', after.author === undefined && after.since === undefined && after.path === undefined)
ok('全部清除后回到当前分支范围', after.allRefs === undefined && after.ref === undefined)

console.log('')
console.log('== 搜索框自带的 × ==')
const box = byClass(t, 'dsh-git-logsearch-input')[0]
box.props.onChange({ target: { value: 'AS2' } })
await wait(10)
t = await settle('pop')
ok('有草稿时搜索框出现 ×', byClass(t, 'dsh-git-logsearch-x').length === 1)
byClass(t, 'dsh-git-logsearch-input')[0].props.onKeyDown({ key: 'Enter', preventDefault() {} })
await wait(15)
t = await settle('pop')
ok('回车把搜索交给 history 查询', lastGraph().args.search === 'AS2')
byClass(t, 'dsh-git-logsearch-x')[0].props.onClick({ stopPropagation() {} })
await wait(15)
t = await settle('pop')
ok('× 之后 history 不再带 search', lastGraph().args.search === undefined)
ok('× 之后搜索框空了', byClass(t, 'dsh-git-logsearch-input')[0].props.value === '')

console.log('')
console.log('== 面板头部：仓库路径也能一键清空 ==')
ok('路径框是可清除的框', byClass(t, 'dsh-git-clearable-path').length === 1)
ok('空的时候不显示 ×', byClass(byClass(t, 'dsh-git-clearable-path')[0], 'dsh-git-clear-x').length === 0)
byClass(t, 'dsh-git-repo-path')[0].props.onChange({ target: { value: '/tmp/other' } })
await wait(5)
t = await settle('pop')
const repoX = byClass(byClass(t, 'dsh-git-clearable-path')[0], 'dsh-git-clear-x')[0]
ok('填了内容就出现 ×', repoX !== undefined)
repoX.props.onClick({ stopPropagation() {} })
await wait(10)
t = await settle('pop')
ok('点 × 清空了仓库路径', byClass(t, 'dsh-git-repo-path')[0].props.value === '')

console.log('')
console.log('== 标签 / 分支 的内联输入：也能一键清空 ==')
const promptInput = () => collect(byClass(t, 'dsh-git-prompt')[0]).find((n) => n.type === 'input')
byClass(t, 'dsh-git-tool-ico')[2].props.onClick()
await wait(10)
t = await settle('pop')
ok('点标签图标后出现输入行', byClass(t, 'dsh-git-prompt').length === 1)
ok('空的时候没有 ×', byClass(byClass(t, 'dsh-git-prompt')[0], 'dsh-git-clear-x').length === 0)
promptInput().props.onChange({ target: { value: 'v1.0.0' } })
await wait(5)
t = await settle('pop')
const promptX = byClass(byClass(t, 'dsh-git-prompt')[0], 'dsh-git-clear-x')[0]
ok('输入后出现 ×', promptX !== undefined)
promptX.props.onClick({ stopPropagation() {} })
await wait(5)
t = await settle('pop')
ok('点 × 清空了标签名', promptInput().props.value === '')

console.log('')
console.log('== 提交信息框：也能一键清空 ==')
byClass(t, 'dsh-git-tab')[0].props.onClick()
await wait(15)
t = await settle('pop')
const msgArea = () => collect(byClass(t, 'dsh-git-commitpane')[0]).find((n) => n.type === 'textarea')
ok('提交信息是多行的可清除框', byClass(t, 'dsh-git-clearable-area').length === 1)
ok('空的时候没有 ×', byClass(byClass(t, 'dsh-git-clearable-area')[0], 'dsh-git-clear-x').length === 0)
msgArea().props.onChange({ target: { value: 'fix: something' } })
await wait(5)
t = await settle('pop')
const msgX = byClass(byClass(t, 'dsh-git-clearable-area')[0], 'dsh-git-clear-x')[0]
ok('写了提交信息就出现 ×', msgX !== undefined)
msgX.props.onClick({ stopPropagation() {} })
await wait(5)
t = await settle('pop')
ok('点 × 清空了提交信息', msgArea().props.value === '')

console.log('')
console.log('== 初次打开：不预选任何提交 ==')
/* 全新挂载一次，模拟「刚打开弹层」 */
fibers.clear()
calls.length = 0
let fresh = await openPanel()
fresh = await settle('pop')
const crowSel = () => byClass(fresh, 'dsh-git-crow-sel')
ok('打开后一行提交都没有被选中', crowSel().length === 0)
ok('也没有替用户去读提交详情', calls.filter((c) => c.method === 'git/commit-detail').length === 0)
ok('右栏是空态「选择一个提交」', textOf(byClass(fresh, 'dsh-git-detail')[0]).indexOf('选择一个提交') >= 0)
ok('提交操作按钮此时是禁用的', byClass(fresh, 'dsh-git-tool-ico').every((b) => b.props.disabled === true))
ok('列表本身有内容（不是没读到）', byClass(fresh, 'dsh-git-crow').length === 3)

console.log('')
console.log('== 点一行才选中，并去读它的详情 ==')
calls.length = 0
byClass(fresh, 'dsh-git-crow')[1].props.onClick()
await wait(15)
fresh = await settle('pop')
ok('点的那一行被选中', crowSel().length === 1 && textOf(crowSel()[0]).indexOf('second commit') >= 0)
ok('只为点的那一行读详情', calls.filter((c) => c.method === 'git/commit-detail').map((c) => c.args.hash).join(',') === 'bbb222')
ok('右栏换成了那个提交', textOf(byClass(fresh, 'dsh-git-detail')[0]).indexOf('detail subject') >= 0)
ok('选中后操作按钮解禁', byClass(fresh, 'dsh-git-tool-ico').every((b) => b.props.disabled !== true))

console.log('')
console.log('== 重新读历史：选中的还在就保留，不在了就清空 ==')
byClass(fresh, 'dsh-git-lf-select')[1].props.onChange({ target: { value: 'mays@example.com' } })
await wait(15)
fresh = await settle('pop')
ok('筛选导致重读后，选中的提交还在', crowSel().length === 1 && textOf(crowSel()[0]).indexOf('second commit') >= 0)
graphCommits = graphCommits.filter((c) => c.hash !== 'bbb222')
byClass(fresh, 'dsh-git-lf-select')[1].props.onChange({ target: { value: '' } })
await wait(15)
fresh = await settle('pop')
ok('选中那行被筛掉后，没有自动改选别的', crowSel().length === 0)
ok('右栏回到空态', textOf(byClass(fresh, 'dsh-git-detail')[0]).indexOf('选择一个提交') >= 0)
