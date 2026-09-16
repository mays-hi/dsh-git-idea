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
/* ═══ gp42：一个文件的差异 ═══
   面板能说「哪个文件改了」很久了：变更树、提交下的文件列表都是这样。但两处的行
   都到那里为止 —— 没有一次读取返回过 patch，所以一个文件可以被报告成「改了」，却
   永远看不到「改成什么样」。这个套件盯的就是补上的那一块：

   1. 两个列表里的文件行点开就是差异；返回键回到列表
   2. 一个文件同时有已暂存和未暂存两段时，两次读取分别落在两个小节里
   3. 行号来自 @@ 的计数，删除行只出现在旧文件一侧
   4. 未跟踪的二进制文件不当作文本显示；只有一次读取
   5. 提交下的文件读的是那次提交（重命名的旧路径一起带上）
   6. 勾选框在固定的一列；git 折叠掉的未跟踪目录也有行
   7. 点一下勾选框：立刻画出来，不会被迟到的读抹掉
   8. 树行的手势：单击只选中，双击或点三角才展开 */

const L = function () {
  let out = ''
  for (let i = 0; i < arguments.length; i += 1) out += arguments[i] + '\n'
  return out
}

/* git 自己就是这么印的：`---`/`+++` 是文件头，不是被删掉/加上的行。 */
const PATCH_WORKTREE = L(
  'diff --git a/src/app.js b/src/app.js',
  'index 1111111..2222222 100644',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -3,3 +3,4 @@ const x = 1',
  ' line three',
  '-old line',
  '+new line',
  '+extra',
  ' tail')

const PATCH_STAGED = L(
  'diff --git a/src/app.js b/src/app.js',
  'index 0000000..1111111 100644',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -0,0 +1 @@',
  '+staged line')

const PATCH_COMMIT = L(
  'diff --git a/old.txt b/new.txt',
  'similarity index 83%',
  'rename from old.txt',
  'rename to new.txt',
  '--- a/old.txt',
  '+++ b/new.txt',
  '@@ -1,2 +1,3 @@',
  ' keep',
  '+added in commit')

const diffCalls = []
const untrackedCalls = []
const baseCall = host.call
host.call = function (method, args) {
  if (method === 'git/panel') {
    calls.push({ method: method, args: args })
    const reply = {
      ok: true, repo: '/tmp/ws', branch: 'main', detached: false,
      upstream: 'origin/main', ahead: 0, behind: 0, sequencer: null,
    }
    if (args != null && args.quick === true) return Promise.resolve(reply)
    return Promise.resolve(Object.assign(reply, {
      staged: [{ path: 'src/app.js', code: 'M' }],
      unstaged: [{ path: 'src/app.js', code: 'M' }, { path: 'notes.md', code: 'M' }],
      untracked: ['tmp.bin', 'newdir/'],
      unmerged: [],
    }))
  }
  if (method === 'git/commit-detail') {
    return Promise.resolve({
      ok: true, repo: '/tmp/ws', hash: (args && args.hash) || 'aaa111', subject: 'detail subject', body: '',
      author: 'mays', email: 'mays@example.com', date: '2026-09-16T10:00:00',
      files: [{ status: 'R100', path: 'new.txt', from: 'old.txt' }], branches: ['main'],
    })
  }
  if (method === 'git/untracked') {
    untrackedCalls.push(args)
    return Promise.resolve({ ok: true, dir: args.dir, files: ['newdir/a.txt', 'newdir/deep/b.txt'], truncated: false })
  }
  if (method === 'git/diff') {
    diffCalls.push(args)
    const mode = args != null ? args.mode : ''
    if (mode === 'staged') {
      return Promise.resolve({ ok: true, mode: mode, path: args.path, text: PATCH_STAGED, added: 1, removed: 0, binary: false, truncated: false, empty: false })
    }
    if (mode === 'worktree') {
      return Promise.resolve({ ok: true, mode: mode, path: args.path, text: PATCH_WORKTREE, added: 2, removed: 1, binary: false, truncated: false, empty: false })
    }
    if (mode === 'untracked') {
      return Promise.resolve({ ok: true, mode: mode, path: args.path, text: '', added: 0, removed: 0, binary: true, truncated: false, empty: true })
    }
    if (mode === 'commit') {
      return Promise.resolve({ ok: true, mode: mode, path: args.path, text: PATCH_COMMIT, added: 1, removed: 0, binary: false, truncated: false, empty: false })
    }
    return Promise.resolve({ ok: false, error: 'unknown-mode', stderr: 'nope' })
  }
  return baseCall(method, args)
}

const changeRow = function (tree, label) {
  return byClass(tree, 'dsh-git-trow').find(function (r) { return textOf(r).indexOf(label) >= 0 })
}
const toolByTitle = function (tree, title) {
  return collect(tree).filter(function (n) { return n.type === 'button' && n.props.title === title })[0]
}
const modes = function () { return diffCalls.map(function (c) { return c.mode + '@' + c.path }) }

/* ── 1. 变更页：计数、点开、返回 ── */

let tree = await openPanel()
const changesTab = buttons(tree).find(function (b) { return textOf(b).indexOf('变更') >= 0 })
ok('变更页签上带着未提交文件数（否则它只是个没有内容暗示的页签）', textOf(changesTab) === '变更4')
changesTab.props.onClick()
await wait(10)
tree = await settle()

const appRow = changeRow(tree, 'app.js')
ok('变更列表里有 src/app.js 这一行', appRow !== undefined)
ok('文件行的提示写着可以点开', appRow !== undefined && String(appRow.props.title).indexOf('点开看差异') >= 0)

appRow.props.onClick()
await wait(10)
tree = await settle()

console.log('')
console.log('== 变更页里的一个文件 ==')
ok('一次问了两段：已暂存 + 未暂存（这个文件两段都有）',
  modes().join(' , ') === 'staged@src/app.js , worktree@src/app.js')
/* 面板没「应用」过别的路径时，请求里只有会话：仓库由 Host 从那一次会话的工作目录
   解出来，和面板其它读一样 —— 带上一个猜的路径才是错的。 */
ok('两次都带上了会话（仓库由 Host 从会话解出）',
  diffCalls.every(function (c) { return c.sessionId === 's-1' && c.repo === undefined }))
ok('表头写着路径', textOf(byClass(tree, 'dsh-git-diffpath')[0]) === 'src/app.js')
ok('表头合计 +3 −1（两段相加）', textOf(byClass(tree, 'dsh-git-diffcount')[0]).replace(/\s/g, '') === '+3−1')
const sections = byClass(tree, 'dsh-git-diffsec').map(function (n) { return textOf(n) })
ok('两段各有一个小节标题', sections.length === 2 && sections[0].indexOf('已暂存') === 0 && sections[1].indexOf('未暂存') === 0)
ok('小节标题里也带各自的数', sections[0].indexOf('+1') > 0 && sections[1].indexOf('+2') > 0)

/* @@ -3,3 +3,4 @@：上下文行占 3/3，删除行占旧 4，两个新增行占新 4、5，
   最后一行上下文占旧 5/新 6。 */
const addRows = byClass(tree, 'dsh-git-dl-add')
const delRows = byClass(tree, 'dsh-git-dl-del')
const newLine = addRows.find(function (r) { return textOf(r).indexOf('new line') >= 0 })
const newNos = newLine === undefined ? [] : byClass(newLine, 'dsh-git-dno').map(function (n) { return textOf(n) })
ok('新增行的行号落在新文件一侧', newNos.length === 2 && newNos[0] === '' && newNos[1] === '4')
const extraNos = byClass(addRows.find(function (r) { return textOf(r).indexOf('extra') >= 0 }) || {}, 'dsh-git-dno').map(function (n) { return textOf(n) })
ok('紧接着的下一个新增行是 5', extraNos[1] === '5')
const delNos = byClass(delRows.find(function (r) { return textOf(r).indexOf('old line') >= 0 }) || {}, 'dsh-git-dno').map(function (n) { return textOf(n) })
ok('删除行只出现在旧文件一侧', delNos[0] === '4' && delNos[1] === '')
ok('文件头不计进增删数（+++/--- 是头，不是行）', addRows.every(function (r) { return textOf(r).indexOf('+++') < 0 }))
ok('@@ 那一行单独成一类', byClass(tree, 'dsh-git-dl-hunk').length === 2)

/* 这个文件两段都有：差异页上的按钮说的是「取消暂存」，因为索引里已经有它了。 */
const stageBtn = buttons(tree).find(function (b) { return textOf(b) === '取消暂存' })
ok('差异页上能直接暂存这个文件', stageBtn !== undefined)
const beforeStageCalls = diffCalls.length
stageBtn.props.onClick()
await wait(10)
tree = await settle()
/* 这个文件已经在索引里了，所以按钮是「取消暂存」：点它就撤下来。 */
ok('差异页上的按钮撤下索引里的那个文件',
  calls.some(function (c) { return c.method === 'git/unstage' && c.args.paths[0] === 'src/app.js' }))
ok('暂存之后补一次工作区读', calls.filter(function (c) { return c.method === 'git/panel' && c.args.quick !== true }).length >= 2)

const back = toolByTitle(tree, '返回文件列表')
ok('返回键在', back !== undefined)
back.props.onClick()
await wait(10)
tree = await settle()
ok('返回后又是文件列表', changeRow(tree, 'app.js') !== undefined && byClass(tree, 'dsh-git-diffview').length === 0)
ok('返回没有再发读取', diffCalls.length === beforeStageCalls)

/* ── 4. 未跟踪的二进制：只读一次，不当作文本 ── */

const binCalls = diffCalls.length
changeRow(tree, 'tmp.bin').props.onClick()
await wait(10)
tree = await settle()
console.log('')
console.log('== 未跟踪的二进制 ==')
ok('只问一次（未跟踪没有 HEAD 那一侧）', diffCalls.length - binCalls === 1 && diffCalls[diffCalls.length - 1].mode === 'untracked')
ok('不当作文本渲染', byClass(tree, 'dsh-git-dline').length === 0)
ok('说清楚了是二进制', textOf(tree).indexOf('二进制') >= 0)
/* 一个 git 还没见过的文件，正是最想从这儿放进索引的那种。 */
const addBtn = buttons(tree).find(function (b) { return textOf(b) === '暂存' })
ok('未跟踪的文件在差异页上能直接暂存', addBtn !== undefined)
if (addBtn !== undefined) {
  addBtn.props.onClick()
  await wait(10)
  tree = await settle()
}
ok('走的是 git/stage', calls.some(function (c) { return c.method === 'git/stage' && c.args.paths[0] === 'tmp.bin' }))

/* ── 5. 提交下的文件：读那一次提交，重命名的旧路径一起带上 ── */

const commitCalls = diffCalls.length
toolByTitle(tree, '返回文件列表').props.onClick()
await wait(10)
tree = await settle()
buttons(tree).find(function (b) { return textOf(b).indexOf('历史') >= 0 }).props.onClick()
await wait(10)
tree = await settle()

const commitRow = byClass(tree, 'dsh-git-crow')[0]
ok('历史页有提交行', commitRow !== undefined)
commitRow.props.onClick()
await wait(10)
tree = await settle()
const commitFile = changeRow(tree, 'new.txt')
ok('提交详情里列出了文件', commitFile !== undefined)
commitFile.props.onClick()
await wait(10)
tree = await settle()

console.log('')
console.log('== 提交里的一个文件 ==')
const last = diffCalls[diffCalls.length - 1]
ok('读的是 commit 模式，ref 是这次提交', diffCalls.length - commitCalls === 1 && last.mode === 'commit' && last.ref === 'aaa111')
ok('重命名的旧路径跟着一起给 git（只给新路径的话它会报成新增）', last.from === 'old.txt')
ok('重命名那几行也显示出来', textOf(tree).indexOf('rename from old.txt') >= 0)
ok('表头还是 +1 −0', textOf(byClass(tree, 'dsh-git-diffcount')[0]).replace(/\s/g, '') === '+1−0')
ok('提交里的文件不给暂存按钮', buttons(tree).every(function (b) { return textOf(b) !== '暂存' && textOf(b) !== '取消暂存' }))

/* 刷新键：同一个文件重新读一次，请求原样 */
const beforeRefresh = diffCalls.length
toolByTitle(tree, '重新读取这个文件的差异').props.onClick()
await wait(10)
await settle()
ok('刷新键重新读一次同一个文件', diffCalls.length - beforeRefresh === 1 && diffCalls[diffCalls.length - 1].path === 'new.txt')

/* ── 一条源码规矩 ──
   差异的「身份」必须把路径算进去。同一个提交里的两个文件，请求的形状（模式、ref）
   完全一样：少了路径，视图会把上一个文件的 patch 留在新文件的名字下面 —— 那是
   最坏的一种错，因为它看起来是对的。现在从列表进差异必然先卸载再挂载，所以这条
   还是预防性的；将来要是把列表和差异摆在一起，它就是承重的。 */
const sourceText = fs.readFileSync(process.env.GP_SRC || new URL('../client.js', import.meta.url).pathname, 'utf8')
const shapeSource = sourceText.slice(sourceText.indexOf('function diffShape'), sourceText.indexOf('function hunkHeader'))
console.log('')
console.log('== 源码规矩 ==')
ok('差异的身份里带着路径与重命名的旧路径',
  shapeSource.indexOf('text(target.path)') >= 0 && shapeSource.indexOf('text(target.from)') >= 0)
ok('那两行确实进了依赖表（shape 在 useEffect 的依赖里）',
  sourceText.indexOf('[shape, props.repo, props.sessionId, props.sig]') >= 0)

/* ── 6. 勾选框那一列，和被折叠的未跟踪目录 ──
   截图量出来的两件事：每个目录层级把勾选框往右推一格（深度 5 的时候框已经在
   60px 处），所以一列框永远对不齐；而 git 折叠掉的未跟踪目录（路径以 / 结尾）
   在树里根本没有行 —— 变更页签说 12 个，树里只数得出 10 个，那两个目录里的文件
   既看不见也暂存不了。 */

console.log('')
console.log('== 勾选框那一列 ==')
/* 上一节停在历史页的提交差异里：先退出来，再回到变更页 */
toolByTitle(tree, '返回文件列表').props.onClick()
await wait(10)
tree = await settle()
buttons(tree).find(function (b) { return textOf(b).indexOf('变更') >= 0 }).props.onClick()
await wait(10)
tree = await settle()

const listRows = byClass(tree, 'dsh-git-trow').filter(function (r) { return String(r.props.className).indexOf('dsh-git-trow-head') < 0 })
ok('每一行的第一个孩子都是勾选框（框在最左边一列）',
  listRows.length >= 4 && listRows.every(function (r) {
    const kids = r.props.children || []
    return kids.length > 0 && String(kids[0].props.className).indexOf('dsh-git-cbox') >= 0
  }))
ok('行自己不再带缩进（缩进是行内的空块，所以框不会被推着走）',
  listRows.every(function (r) { return r.props.style === undefined || r.props.style.paddingLeft === undefined }))
const padOf = function (row) {
  const pad = byClass(row, 'dsh-git-tind')[0]
  return pad === undefined ? null : pad.props.style.width
}
ok('顶层行的缩进块宽度是 0', padOf(changeRow(tree, 'notes.md')) === '0px')
ok('下一层是 12px（缩进仍然逐层加宽，只是不再动勾选框）',
  padOf(changeRow(tree, 'app.js')) === '12px')

console.log('')
console.log('== 被折叠的未跟踪目录 ==')
const dirRow = changeRow(tree, 'newdir/')
ok('git 折叠掉的目录照样有一行（以前它被整行丢掉）', dirRow !== undefined)
ok('这一行说得出自己是目录', byClass(dirRow, 'dsh-git-tdir').length === 1)
ok('它也有展开的三角', byClass(dirRow, 'dsh-git-tw').length === 1)
ok('它的缩进块和同层文件一样是 0', padOf(dirRow) === '0px')

byClass(dirRow, 'dsh-git-tw')[0].props.onClick({ stopPropagation: function () {} })
await wait(10)
tree = await settle()
ok('展开时才去读一次目录里的文件', untrackedCalls.length === 1 && untrackedCalls[0].dir === 'newdir/')
ok('读的是这个会话的那次请求', untrackedCalls[0].sessionId === 's-1')

const insideRow = changeRow(tree, 'a.txt')
ok('目录里的文件成为子行', insideRow !== undefined)
ok('子行按名字显示（相对目录的路径）', textOf(insideRow).indexOf('newdir') < 0)
ok('子行缩进一层', padOf(insideRow) === '12px')
ok('子行也是勾选框在最左', String((insideRow.props.children || [])[0].props.className).indexOf('dsh-git-cbox') >= 0)

const beforeChildDiff = diffCalls.length
insideRow.props.onClick()
await wait(10)
tree = await settle()
const childAsk = diffCalls[diffCalls.length - 1]
ok('点开目录里的文件就是它的差异', diffCalls.length - beforeChildDiff === 1
  && childAsk.mode === 'untracked' && childAsk.path === 'newdir/a.txt')

toolByTitle(tree, '返回文件列表').props.onClick()
await wait(10)
tree = await settle()
const deepRow = changeRow(tree, 'deep/b.txt')
ok('多层子路径也照常显示', deepRow !== undefined)
const beforeChildStage = calls.length
byClass(deepRow, 'dsh-git-cbox')[0].props.onClick({ stopPropagation: function () {} })
await wait(10)
tree = await settle()
ok('子行的勾选框暂存的是那个文件本身',
  calls.some(function (c) { return c.method === 'git/stage' && c.args.paths[0] === 'newdir/deep/b.txt' }))

const beforeDirStage = calls.length
const dirAgain = changeRow(tree, 'newdir/')
byClass(dirAgain, 'dsh-git-cbox')[0].props.onClick({ stopPropagation: function () {} })
await wait(10)
await settle()
ok('目录那一行的勾选框暂存整个目录（git add -- dir 不需要先列出内容）',
  calls.some(function (c) { return c.method === 'git/stage' && c.args.paths[0] === 'newdir/' }))

/* ── 7. 点一下勾选框：立刻有反应，而且不会被迟到的读抹掉 ──

   在读者那台机器上量过：`git add` 是 98–236ms，而面板原来要等一次整棵树的
   `git status` 才把框画出来 —— 那里是 7.4s（冷的时候 13.6s）。点一下等七秒，
   和点一下没反应是同一件事，所以框现在从点击本身画出来，随后的读只确认它。
   下面盯的就是这条链的四件事：立刻画、只问这些路径、失败就还原、旧读不许翻盘。 */

console.log('')
console.log('== 点一下勾选框 ==')

const savedCall = host.call
const glyphOf = function (row) {
  const box = row === undefined ? undefined : byClass(row, 'dsh-git-cbox')[0]
  return box === undefined ? null : textOf(box)
}
const stagedLine = function (tree) {
  const line = collect(tree).filter(function (n) { return String(textOf(n)).indexOf('已暂存 ') >= 0 })[0]
  return line === undefined ? '' : textOf(line)
}
const clickBox = async function (label) {
  const row = changeRow(tree, label)
  byClass(row, 'dsh-git-cbox')[0].props.onClick({ stopPropagation: function () {} })
  await wait(10)
  return await settle()
}

/* 7a. git 还没回话，框就得动 */
const beforeTick = changeRow(tree, 'notes.md')
ok('点之前 notes.md 是没暂存的空框', glyphOf(beforeTick) === '☐' && stagedLine(tree).indexOf('已暂存 1 ') >= 0)
let releaseStage = null
host.call = function (method, args) {
  if (method === 'git/stage') {
    calls.push({ method: method, args: args })
    return new Promise(function (resolve) { releaseStage = resolve })
  }
  return savedCall(method, args)
}
const tickCalls = calls.length
tree = await clickBox('notes.md')
ok('git 还没回话，框就已经是已暂存（不再等那一次整树读）', glyphOf(changeRow(tree, 'notes.md')) === '☑')
ok('「已暂存 N」跟着动（还是没等 git）', stagedLine(tree).indexOf('已暂存 2 ') >= 0)
ok('这一下确实发出去了', calls.length > tickCalls
  && calls.some(function (c) { return c.method === 'git/stage' && c.args.paths[0] === 'notes.md' }))

/* 7b. 确认读只问这些路径 —— 整棵树 7.4s，这些路径 0.5s */
const targetReads = function () {
  return calls.filter(function (c) {
    return c.method === 'git/panel' && c.args.quick !== true && Array.isArray(c.args.paths)
  })
}
if (releaseStage !== null) releaseStage({ ok: true, repo: '/tmp/ws', stdout: '', stderr: '', exitCode: 0 })
host.call = savedCall
tree = await settle()
const confirmAsk = targetReads()[targetReads().length - 1]
ok('确认读按路径问（不是整棵树）', confirmAsk !== undefined && confirmAsk.args.paths.length === 1
  && confirmAsk.args.paths[0] === 'notes.md')
ok('确认读仍带着这个会话', confirmAsk.args.sessionId === 's-1' && confirmAsk.args.repo === undefined)

/* 7c. 一次正在飞的整树读，不许把刚点的框擦回去 */
let releaseFull = null
host.call = function (method, args) {
  if (method === 'git/panel' && args != null && args.quick !== true) {
    calls.push({ method: method, args: args })
    if (Array.isArray(args.paths)) {
      /* 这一节里 mock 照刚才那次点击回答，这样确认读真的是「确认」 */
      return Promise.resolve({
        ok: true, partial: true, paths: args.paths, repo: '/tmp/ws', branch: 'main', detached: false,
        upstream: '', ahead: 0, behind: 0, sequencer: null,
        staged: [{ path: 'notes.md', code: 'M' }], unstaged: [], untracked: [], unmerged: [],
      })
    }
    return new Promise(function (resolve) { releaseFull = resolve })
  }
  return savedCall(method, args)
}
toolByTitle(tree, '重新读取仓库（忽略缓存）').props.onClick()
await wait(10)
tree = await settle()
ok('刷新键发出的是一次整树读，它还没回来', releaseFull !== null)
tree = await clickBox('notes.md')
ok('在读还没回来的时候点：框照样立刻是已暂存', glyphOf(changeRow(tree, 'notes.md')) === '☑')
if (releaseFull !== null) {
  /* 这份回答描述的是点击之前的工作区：它要是画上去，刚点的那一下就没了 */
  releaseFull({
    ok: true, repo: '/tmp/ws', branch: 'main', detached: false, upstream: '', ahead: 0, behind: 0, sequencer: null,
    staged: [], unstaged: [{ path: 'notes.md', code: 'M' }, { path: 'stale.txt', code: 'M' }], untracked: [], unmerged: [],
  })
}
host.call = savedCall
tree = await settle()
ok('迟到的旧读被丢掉，框还在（这就是「点一下又丢失」的那个 bug）', glyphOf(changeRow(tree, 'notes.md')) === '☑')
ok('旧读里的别的改动也没被画上去', changeRow(tree, 'stale.txt') === undefined)

/* 7d. git 拒绝的时候：还原，并且说清楚 */
const failBefore = host.call
host.call = function (method, args) {
  if (method === 'git/stage') {
    calls.push({ method: method, args: args })
    return Promise.resolve({ ok: false, repo: '/tmp/ws', stdout: '', stderr: 'fatal: pathspec did not match', exitCode: 1, command: 'git add -- tmp.bin' })
  }
  return failBefore(method, args)
}
tree = await clickBox('tmp.bin')
ok('git 拒绝了：框退回原样', glyphOf(changeRow(tree, 'tmp.bin')) === '☐')
ok('并且把 git 的话显示出来', byClass(tree, 'dsh-git-error').length > 0 && textOf(tree).indexOf('pathspec did not match') >= 0)
host.call = failBefore
await settle()

/* ── 8. 树行的手势：单击只选中，双击或点三角才展开 ──

   这是 IDEA 的项目树手势，也是读者点名要的那一条：行的第一次点击只是把这一行选中，
   树的形状一点不动；展开/折叠要么双击整行，要么点它左边那个三角。

   对它较真的是未跟踪目录：展开它要读一次目录内容（一次读取），而单击不该顺手把它
   带走 —— 单击就展开的话，想「只选中这一行」的人每次都要多一次目录读。这一节把
   手势逐条钉住，顺带钉住唯一不在这条规矩上的那种行：文件行仍然是单击就看差异，
   那是 IDEA 提交窗口自己的手势（竖着排的列表旁边就是差异，选中即预览）。 */

console.log('')
console.log('== 单击只选中，双击或三角才展开 ==')

const selectedRows = function (t) {
  return byClass(t, 'dsh-git-trow').filter(function (r) {
    return String(r.props.className).split(' ').indexOf('dsh-git-trow-sel') >= 0
  })
}
const isSelected = function (t, label) {
  const row = changeRow(t, label)
  return row !== undefined && String(row.props.className).split(' ').indexOf('dsh-git-trow-sel') >= 0
}
/* 未跟踪目录的展开是一次 git/untracked；这一节数的就是它 */
const dirReads = function () { return untrackedCalls.length }

/* 8a. 已跟踪的目录行：单击只是选中 */
const srcRow = changeRow(tree, 'src')
ok('目录行有它自己的三角（展开是这一个控件的事）',
  srcRow !== undefined && byClass(srcRow, 'dsh-git-tw').length === 1)
const beforeDirClick = calls.length
srcRow.props.onClick()
await wait(10)
tree = await settle()
ok('单击目录行：子行还在（树没有动）', changeRow(tree, 'app.js') !== undefined)
ok('单击目录行：没有发出任何读取', calls.length === beforeDirClick)
ok('单击目录行：这一行变成选中', isSelected(tree, 'src') && selectedRows(tree).length === 1)

/* 8b. 双击同一个目录行：这才收起来 */
/* 手势要是退回「单击就展开」，这一节该报一排 ✗ 而不是抛栈：抛出去会把后面
   所有段落一起带走。 */
const srcAgain = changeRow(tree, 'src')
if (typeof srcAgain.props.onDoubleClick === 'function') srcAgain.props.onDoubleClick()
await wait(10)
tree = await settle()
ok('双击目录行：子行收起来了', changeRow(tree, 'app.js') === undefined)
ok('双击也只是折叠，没有触发别的读取', calls.length === beforeDirClick)
ok('双击之后选中的还是这一行', isSelected(tree, 'src'))

/* 8c. 三角：展开它，并且不把选中改到别的行上去 */
let twistyStopped = false
byClass(changeRow(tree, 'src'), 'dsh-git-tw')[0].props.onClick({ stopPropagation: function () { twistyStopped = true } })
await wait(10)
tree = await settle()
ok('点三角会拦住冒泡（所以它顺手改不了选中）', twistyStopped)
ok('点三角：子行回来了', changeRow(tree, 'app.js') !== undefined)
ok('点三角：选中的还是原来那一行', isSelected(tree, 'src') && selectedRows(tree).length === 1)

/* 8d. 未跟踪目录：先收起来（它是第 6 节展开的） */
const newdirRow = function (t) { return changeRow(t, 'newdir/') }
ok('未跟踪目录行还在（子行也还在）', newdirRow(tree) !== undefined && changeRow(tree, 'a.txt') !== undefined)
const beforeCollapse = dirReads()
byClass(newdirRow(tree), 'dsh-git-tw')[0].props.onClick({ stopPropagation: function () {} })
await wait(10)
tree = await settle()
ok('收起未跟踪目录：不读任何东西（列表只是藏起来）', dirReads() === beforeCollapse)
ok('收起之后子行不见了', changeRow(tree, 'a.txt') === undefined)

/* 8e. 折叠着的未跟踪目录上单击：只选中 */
const beforeSingle = calls.length
newdirRow(tree).props.onClick()
await wait(10)
tree = await settle()
ok('单击未跟踪目录：只选中，没有去读目录里的文件',
  isSelected(tree, 'newdir/') && dirReads() === beforeCollapse && calls.length === beforeSingle)
ok('单击未跟踪目录：树还是折着的', changeRow(tree, 'a.txt') === undefined)

/* 8f. 双击（真实的双击会先来两次单击，再来 onDoubleClick）：只读一次 */
const beforeDouble = dirReads()
const doubleRow = newdirRow(tree)
doubleRow.props.onClick()
doubleRow.props.onClick()
if (typeof doubleRow.props.onDoubleClick === 'function') doubleRow.props.onDoubleClick()
await wait(10)
tree = await settle()
ok('双击未跟踪目录：这才读一次目录内容', dirReads() - beforeDouble === 1)
ok('双击未跟踪目录：文件列出来了', changeRow(tree, 'a.txt') !== undefined && changeRow(tree, 'deep/b.txt') !== undefined)

/* 8g. 再展开一次会重新读：暂存/提交之后那份列表就是会变的东西 */
byClass(newdirRow(tree), 'dsh-git-tw')[0].props.onClick({ stopPropagation: function () {} })
await wait(10)
tree = await settle()
const beforeReopen = dirReads()
byClass(newdirRow(tree), 'dsh-git-tw')[0].props.onClick({ stopPropagation: function () {} })
await wait(10)
tree = await settle()
ok('再展开一次重新读一次（不拿上一次的旧列表凑数）', dirReads() - beforeReopen === 1)

/* 8h. 唯一不在这条规矩上的行：文件行的单击就是「看差异」 */
const beforeFileClick = diffCalls.length
changeRow(tree, 'notes.md').props.onClick()
await wait(10)
tree = await settle()
ok('文件行仍是「单击就看差异」（提交窗口里选中即预览的那个手势）',
  diffCalls.length - beforeFileClick === 1 && diffCalls[diffCalls.length - 1].path === 'notes.md')
toolByTitle(tree, '返回文件列表').props.onClick()
await wait(10)
tree = await settle()
ok('返回后还是那棵树，目录的展开状态也还在',
  changeRow(tree, 'app.js') !== undefined && changeRow(tree, 'a.txt') !== undefined)
