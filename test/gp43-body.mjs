/* ═══ gp43：机器上的 git，和它在网上做的事 ═══
   设置页一直只有两样东西：插件自己的两个开关，和本浏览器的外观。而读者真正会去那里
   找的是另外三件事 —— 我是谁（提交身份）、我用的是哪个 git（装在 PATH 之外时怎么
   办）、以及 fetch / pull / push 到底带不带那几个参数。这个套件盯的就是这三块，加上
   它们唯一一处会动手的地方：推送没有上游的分支时，面板会不会自己把那一步走完。

   1. 提交身份：此刻生效的那一份（连来源一起）、缺哪一半、预填、写入时带的 scope
   2. 空框不写：`git config user.name ''` 正是那个错误的来路，面板不制造它
   3. git 位置：PATH 上的 / 设置里写的 / 写错了 / 一个都没有，四种话各不相同
   4. 远程同步：三个开关，以及「也就是」那行照着实参说
   5. 推送没有上游：开着就自己走完，关着就问一句；走完的那次不再重试

   两条关于这个骨架的注意（踩过）：同一个组件的两次渲染要用**同一个 label**，否则
   fiber 是新的、组件等于重新挂载（状态和 effect 都会重来）；而 `timer.timeout` 在这
   里只是被记下来，不会自己到点 —— 去抖的保存要手动推一下。 */

const configReply = function (over) {
  return Object.assign({
    ok: true, path: '/home/u/.dsh/dsh-git-idea.json',
    config: { initBranch: 'main', cherryPickRecord: false, gitPath: '', fetchPrune: true, pullRebase: false, pushSetUpstream: false },
  }, over)
}

const baseCall = host.call
const identityCalls = []
const identitySaves = []
const toolCalls = []
const configSaves = []
/* 本浏览器那份设置先塞一个非默认值：第 0 节要断言「直接开设置页（输入框旁那颗 chip
   还没挂过）也读得到它」—— 读数挂在 ref 上，而 useState 在渲染时就把默认值定死了，
   之后的通知又发生在订阅之前。 */
store['dsh.git-idea.settings'] = JSON.stringify({ hoverSwitch: false })

/* 这份配置刻意带着一个 Host 有、客户端**没有**写进自己那份名单的键（`repoScanDepth`）：
   它下面那一节盯的就是这个 —— 以前它会被客户端丢掉。 */
let configNow = Object.assign({}, configReply().config, { repoScanDepth: 3 })
let identityReply = {
  ok: true, repo: '/tmp/ws', insideRepo: true,
  name: 'Ada Lovelace', email: 'ada@example.com',
  nameOrigin: '/home/u/.gitconfig', emailOrigin: '/home/u/.gitconfig',
  globalName: 'Ada Lovelace', globalEmail: 'ada@example.com',
  needsIdentity: false, nameMissing: false, emailMissing: false,
}
let toolReply = { ok: true, configured: '', fromPath: true, path: '/usr/bin/git', version: 'git version 2.43.0', found: true, reason: '', platform: 'ok' }

host.call = function (method, args) {
  if (method === 'git/identity') { identityCalls.push(args); return Promise.resolve(identityReply) }
  if (method === 'git/identity-save') {
    identitySaves.push(args)
    return Promise.resolve({
      ok: true, scope: args.scope, written: ['user.name', 'user.email'],
      repo: args.scope === 'local' ? '/tmp/ws' : null,
      name: args.name, email: args.email,
      nameOrigin: args.scope === 'local' ? '.git/config' : '/home/u/.gitconfig', emailOrigin: '/home/u/.gitconfig',
      globalName: args.name, globalEmail: args.email, needsIdentity: false,
    })
  }
  if (method === 'git/toolchain') { toolCalls.push(args); return Promise.resolve(toolReply) }
  if (method === 'git/config') return Promise.resolve(configReply({ config: configNow }))
  if (method === 'git/config-save') { configSaves.push(args.config); configNow = args.config; return Promise.resolve(configReply({ config: args.config })) }
  return baseCall(method, args)
}

const sectionTree = async function (label) { return await renderUntilStable(makeElement(section, {}), label) }
/* 去抖的保存靠这个推一下：骨架里的 timer 只被记下来。 */
const fireTimers = function () {
  timers.filter(function (t) { return t.kind === 'timeout' && t.dead !== true }).forEach(function (t) { t.cb() })
}
const rowTexts = function (t) { return byClass(t, 'dsh-git-set-row').map(function (r) { return textOf(r) }) }
const setRow = function (t, label) { return byClass(t, 'dsh-git-set-row').filter(function (r) { return textOf(r).indexOf(label) >= 0 })[0] }
const inputFor = function (t, label) {
  const row = setRow(t, label)
  return row === undefined ? undefined : collect(row).filter(function (n) { return n.type === 'input' })[0]
}
const inputByPlaceholder = function (t, placeholder) {
  return collect(t).filter(function (n) { return n.type === 'input' && n.props.placeholder === placeholder })[0]
}
const btnWith = function (t, label) { return buttons(t).filter(function (b) { return textOf(b) === label })[0] }
const warnText = function (t) { return byClass(t, 'dsh-git-warn').map(function (n) { return textOf(n) }).join(' | ') }
const effectiveRow = function (t) { return rowTexts(t).filter(function (x) { return x.indexOf('此刻生效') >= 0 })[0] || '' }

/* ── 0. 插件配置：一个键都不能悄悄丢 ──

   客户端以前把 Host 的插件配置 schema 抄了一份白名单，而 `repoScanDepth` 没抄进去：
   那个下拉框永远显示默认的 2（Host 明明答了 3），而且读者改**任何**一个别的插件设置，
   400ms 后落盘的那一份都会把它抹回默认 —— Host 收到一份没有这个键的配置。这一节盯的
   就是「一个键都不能悄悄丢」。 */
console.log('')
console.log('== 设置页 · 插件配置的键一个都不能丢 ==')
const selectFor = function (t, label) {
  const row = setRow(t, label)
  return row === undefined ? undefined : collect(row).filter(function (n) { return n.type === 'select' })[0]
}
let keyTree = await sectionTree('gp43-plugin-keys')
const depthBox = selectFor(keyTree, '往下找几层仓库')
console.log('  repoScanDepth 控件:', JSON.stringify(depthBox === undefined ? null : depthBox.props.value))
ok('Host 答的 repoScanDepth 显示在控件上（不是永远显示默认的 2）',
  depthBox !== undefined && depthBox.props.value === '3')

/* 同一类错：存过的偏好要在**第一帧**就生效，而不是等别的界面 notify 一次。 */
const hoverBox = collect(setRow(keyTree, '鼠标停在输入框旁')).filter(function (n) {
  return n.type === 'input' && n.props.type === 'checkbox'
})[0]
ok('存过的本浏览器偏好第一帧就生效（不需要别人先通知一次）',
  hoverBox !== undefined && hoverBox.props.checked === false)

inputByPlaceholder(keyTree, 'main').props.onChange({ target: { value: 'trunk' } })
await wait(5)
fireTimers()
await wait(20)
console.log('  改 initBranch 之后存下去的:', JSON.stringify(configSaves[configSaves.length - 1]))
ok('改别的键不会把 repoScanDepth 洗掉（以前这里就丢了）',
  configSaves.length >= 1 && configSaves[configSaves.length - 1].initBranch === 'trunk'
  && configSaves[configSaves.length - 1].repoScanDepth === 3)

keyTree = await sectionTree('gp43-plugin-keys')
selectFor(keyTree, '往下找几层仓库').props.onChange({ target: { value: '1' } })
await wait(5)
fireTimers()
await wait(20)
ok('这个下拉框自己也能改（以前点了不动：值当场被白名单丢掉）',
  configSaves[configSaves.length - 1].repoScanDepth === 1)

/* ── 0b. 变更页视图：README 一直把它列在「本浏览器」里，页面上却一直没有这一格 ── */
console.log('')
console.log('== 设置页 · 变更页视图 ==')
keyTree = await sectionTree('gp43-view')
const viewBox = selectFor(keyTree, '变更页视图')
console.log('  控件:', JSON.stringify(viewBox === undefined ? null : viewBox.props.value))
ok('设置页上有这个控件', viewBox !== undefined && viewBox.props.value === 'tree')
viewBox.props.onChange({ target: { value: 'flat' } })
await wait(5)
keyTree = await sectionTree('gp43-view')
ok('选「平铺列表」写进本浏览器那份设置',
  JSON.parse(store['dsh.git-idea.settings']).changesView === 'flat')

/* ── 0c. 「本浏览器全部恢复默认」得真的是全部 ── */
console.log('')
console.log('== 设置页 · 本浏览器全部恢复默认 ==')
store['dsh.git-idea.panel'] = JSON.stringify({ w: 640, h: 480 })
store['dsh.git-idea.stars'] = JSON.stringify(['keep-me'])
keyTree = await sectionTree('gp43-reset')
btnWith(keyTree, '本浏览器全部恢复默认').props.onClick()
await wait(5)
const afterReset = JSON.parse(store['dsh.git-idea.settings'])
const resetSize = JSON.parse(store['dsh.git-idea.panel'])
const resetStars = JSON.parse(store['dsh.git-idea.stars'])
console.log('  恢复之后:', JSON.stringify({ changesView: afterReset.changesView, size: resetSize, stars: resetStars }))
ok('外观与节奏回到默认', afterReset.changesView === 'tree' && afterReset.hoverSwitch === true)
ok('面板尺寸回到「跟随输入框」', resetSize.w === 0 && resetSize.h === 0)
ok('切换器的收藏被清掉', Array.isArray(resetStars) && resetStars.length === 0)

/* ── 1. 缺一半的时候说什么 ── */

console.log('')
console.log('== 设置页 · 提交身份：缺哪一半 ==')
identityReply = Object.assign({}, identityReply, { needsIdentity: true, nameMissing: true, name: '', email: '', nameOrigin: '', emailOrigin: '', globalName: '', globalEmail: '' })
let st = await sectionTree('gp43-ident-missing')
console.log('  缺一半:', JSON.stringify(warnText(st)))
ok('缺名字时明说原因是它，并且说清后果',
  warnText(st).indexOf('还缺：名字') >= 0 && warnText(st).indexOf('提交会被 git 拒绝') >= 0)
ok('这一行是警告色', byClass(st, 'dsh-git-warn').length > 0)
ok('读的时候只给 session id（路径由 Host 从会话解出来，和面板同一条路）',
  identityCalls.length >= 1 && identityCalls[0].repo === undefined && identityCalls[0].sessionId === undefined)

/* 两半都缺：Host 一直把 `emailMissing` 一起带回来，页面却只读了名字那一半 —— 于是
   名字和邮箱都没配的人先被告知「还缺：名字」，填完、保存、再被告知「还缺：邮箱」，
   一件一趟就能说清的事走了两趟。 */
identityReply = Object.assign({}, identityReply, { needsIdentity: true, nameMissing: true, emailMissing: true })
st = await sectionTree('gp43-ident-missing-both')
console.log('  两半都缺:', JSON.stringify(warnText(st)))
ok('两半都缺时一句话说清两半',
  warnText(st).indexOf('还缺：名字和邮箱') >= 0 && warnText(st).indexOf('提交会被 git 拒绝') >= 0)

/* ── 2. 有身份时：值 + 来源、预填、写入 ── */

console.log('')
console.log('== 设置页 · 提交身份：写进去 ==')
identityReply = {
  ok: true, repo: '/tmp/ws', insideRepo: true,
  name: 'Ada Lovelace', email: 'ada@example.com',
  nameOrigin: '/home/u/.gitconfig', emailOrigin: '.git/config',
  globalName: 'Ada Lovelace', globalEmail: 'ada@example.com',
  needsIdentity: false, nameMissing: false, emailMissing: false,
}
st = await sectionTree('gp43-ident')
console.log('  此刻生效:', JSON.stringify(effectiveRow(st)))
ok('「此刻生效」把值连来源一起说（来自哪个文件才有意义）',
  effectiveRow(st).indexOf('Ada Lovelace（来自 /home/u/.gitconfig）') >= 0
  && effectiveRow(st).indexOf('ada@example.com（来自 .git/config）') >= 0)
ok('两个输入框预填了此刻生效的那一份',
  String(inputFor(st, '名字').props.value) === 'Ada Lovelace'
  && String(inputFor(st, '邮箱').props.value) === 'ada@example.com')
ok('有身份时没有警告', byClass(st, 'dsh-git-warn').length === 0)
const radios = collect(st).filter(function (n) { return n.type === 'input' && n.props.type === 'radio' })
ok('写入范围默认是这台机器（--global），也就是 git 自己建议的那一条',
  radios.length === 2 && radios[0].props.checked === true && radios[1].props.checked === false)

inputFor(st, '邮箱').props.onChange({ target: { value: 'new@example.com' } })
await wait(5)
st = await sectionTree('gp43-ident')
console.log('  改了邮箱，再点写入')
btnWith(st, '写入 git 配置').props.onClick()
await wait(20)
st = await sectionTree('gp43-ident')
console.log('  写出去的:', JSON.stringify(identitySaves[0]))
ok('点一下就把两个值写出去，scope 是 global',
  identitySaves.length === 1 && identitySaves[0].scope === 'global'
  && identitySaves[0].name === 'Ada Lovelace' && identitySaves[0].email === 'new@example.com')
ok('写完之后页面把结果说出来（写到哪、写了哪两个字段）',
  rowTexts(st).join(' | ').indexOf('已写进这台机器的 git 配置') >= 0
  && rowTexts(st).join(' | ').indexOf('user.name') >= 0)

/* ── 3. 只对这个仓库：谁记着这个页面在哪个会话里 ── */

console.log('')
console.log('== 只对这个仓库 ==')
/* 设置页是全局的，自己不知道在哪个会话里 —— chip 一直挂在输入框旁，是它把 session
   id 记下来的。先渲染一次 chip，模拟「读者在会话里开着 GUI」。 */
await chipTree('gp43-chip')
st = await sectionTree('gp43-ident')
collect(st).filter(function (n) { return n.type === 'input' && n.props.type === 'radio' })[1].props.onChange()
await wait(5)
st = await sectionTree('gp43-ident')
const localBtn = btnWith(st, '写入 git 配置')
ok('切到「只对这个仓库」之后按钮仍然可按（这个会话有仓库）', localBtn !== undefined && localBtn.props.disabled !== true)
ok('这一行说得出「这个仓库」到底是哪个', rowTexts(st).join(' | ').indexOf('这个仓库 = /tmp/ws') >= 0)
localBtn.props.onClick()
await wait(20)
console.log('  第二次写出去的:', JSON.stringify(identitySaves[1]))
ok('本地 scope 带着 session id（Host 靠它解出仓库，也靠它选沙箱）',
  identitySaves.length === 2 && identitySaves[1].scope === 'local' && identitySaves[1].sessionId === 's-1')
ok('落点也换成了这个仓库', rowTexts(await sectionTree('gp43-ident')).join(' | ').indexOf('已写进 /tmp/ws 的 .git/config') >= 0)

/* 不知道是哪个仓库时：那条路要关掉并说清，而不是猜一个路径往里写。 */
identityReply = Object.assign({}, identityReply, { repo: null, insideRepo: false })
st = await sectionTree('gp43-ident-nowhere')
console.log('  不知道仓库时:', JSON.stringify(rowTexts(st).filter(function (x) { return x.indexOf('还不知道') >= 0 })[0] || ''))
ok('不知道仓库时，页面上写着这件事', rowTexts(st).join(' | ').indexOf('还不知道是哪个会话的仓库') >= 0)
/* 全局那一份仍然可以写（它不需要知道是哪个仓库）；要写本地就没有落点，按钮关掉。 */
ok('这时候全局那份照旧能写', btnWith(st, '写入 git 配置').props.disabled !== true)
collect(st).filter(function (n) { return n.type === 'input' && n.props.type === 'radio' })[1].props.onChange()
await wait(5)
st = await sectionTree('gp43-ident-nowhere')
ok('选「只对这个仓库」而不知道是哪个仓库时，按钮关掉（不猜一个路径往里写）',
  btnWith(st, '写入 git 配置').props.disabled === true)
identityReply = Object.assign({}, identityReply, { repo: '/tmp/ws', insideRepo: true })

/* ── 4. git 位置 ── */

console.log('')
console.log('== 设置页 · git 位置 ==')
const toolRow = function (t) {
  return rowTexts(t).filter(function (x) {
    return x.indexOf('现在用的是') >= 0 || x.indexOf('不可用') >= 0 || x.indexOf('PATH 上没有 git') >= 0
  })[0] || ''
}
st = await sectionTree('gp43-tool')
console.log('  PATH 上:', JSON.stringify(toolRow(st)))
ok('默认说的是「用的是 PATH 上的那一个」，并带版本',
  toolRow(st).indexOf('现在用的是 /usr/bin/git（来自 PATH）') >= 0 && toolRow(st).indexOf('git version 2.43.0') >= 0)
ok('默认这一行不是警告色', byClass(st, 'dsh-git-warn').length === 0)

toolReply = { ok: true, configured: '', fromPath: true, path: '', version: '', found: false, reason: 'not-on-path', platform: 'ok' }
st = await sectionTree('gp43-tool-none')
console.log('  机器上没有:', JSON.stringify(toolRow(st)))
ok('PATH 上找不到 git 时说的是「装上它，或写一个绝对路径」',
  toolRow(st).indexOf('PATH 上没有 git') >= 0 && toolRow(st).indexOf('绝对路径') >= 0)
ok('这一行是警告色（读者要动手）', byClass(st, 'dsh-git-warn').length > 0)

toolReply = { ok: true, configured: '/opt/nope/git', fromPath: false, path: '', version: '', found: false, reason: 'configured-missing', platform: 'ok' }
st = await sectionTree('gp43-tool-bad')
console.log('  写错了:', JSON.stringify(toolRow(st)))
ok('写进去的路径不可用时，说的是「设置里写的这个路径不可用」，而不是「这台机器没有 git」',
  toolRow(st).indexOf('设置里写的这个路径不可用') >= 0 && toolRow(st).indexOf('PATH 上没有 git') < 0)

/* 改路径：去抖之后写进插件配置，同时立刻再检查一次「它到底能不能跑」。 */
toolReply = { ok: true, configured: '/usr/local/bin/git', fromPath: false, path: '/usr/local/bin/git', version: 'git version 2.44.0', found: true, reason: '', platform: 'ok' }
const pathBox = inputByPlaceholder(st, '留空 = 用 PATH 里的 git')
ok('有一个写路径的输入框', pathBox !== undefined)
const toolCallsBefore = toolCalls.length
pathBox.props.onChange({ target: { value: '/usr/local/bin/git' } })
await wait(5)
fireTimers()
await wait(20)
st = await sectionTree('gp43-tool-bad')
console.log('  存下来的 gitPath:', JSON.stringify(configSaves.length > 0 ? configSaves[configSaves.length - 1].gitPath : null))
ok('路径写进插件配置（跟着插件走，换浏览器也一致）',
  configSaves.length >= 1 && configSaves[configSaves.length - 1].gitPath === '/usr/local/bin/git')
ok('改完立刻又问了一次「它到底能不能跑」', toolCalls.length > toolCallsBefore)
ok('结果就显示在下面（写的就是它、版本是新的那个）',
  toolRow(st).indexOf('git version 2.44.0') >= 0 && toolRow(st).indexOf('设置里写的就是它') >= 0)

/* ── 5. 远程同步 ── */

console.log('')
console.log('== 设置页 · 远程同步 ==')
const boxNamed = function (t, label) {
  const row = setRow(t, label)
  return row === undefined ? undefined : collect(row).filter(function (n) { return n.type === 'input' && n.props.type === 'checkbox' })[0]
}
const commandLine = function (t) { return rowTexts(t).filter(function (x) { return x.indexOf('也就是') >= 0 })[0] || '' }
st = await sectionTree('gp43-net')
const fetchBox = boxNamed(st, 'fetch 时删掉远端已经删了的远程分支')
const pullBox = boxNamed(st, 'pull 用 rebase')
const pushBox = boxNamed(st, '推送没有上游的分支时直接推上去')
ok('三个开关都在，而且默认值就是原来的行为',
  fetchBox !== undefined && fetchBox.props.checked === true
  && pullBox !== undefined && pullBox.props.checked === false
  && pushBox !== undefined && pushBox.props.checked === false)
console.log('  也就是:', JSON.stringify(commandLine(st)))
ok('「也就是」那行照着实参说：--prune、不加 --rebase、推送先问一句',
  commandLine(st).indexOf('git fetch --all --prune') >= 0 && commandLine(st).indexOf('git pull ·') >= 0
  && commandLine(st).indexOf('git push（没有上游时由面板问一句）') >= 0)

fetchBox.props.onChange({ target: { checked: false } })
await wait(5)
fireTimers()
await wait(20)
st = await sectionTree('gp43-net')
console.log('  关掉 prune:', JSON.stringify(commandLine(st)))
ok('关掉 prune：fetch 那行就不带它了', commandLine(st).indexOf('git fetch --all ·') >= 0)
ok('同一个插件配置里存下了 false', configSaves[configSaves.length - 1].fetchPrune === false)

boxNamed(st, 'pull 用 rebase').props.onChange({ target: { checked: true } })
await wait(5)
fireTimers()
await wait(20)
st = await sectionTree('gp43-net')
ok('打开 rebase：pull 那行带上 --rebase', commandLine(st).indexOf('git pull --rebase') >= 0)
ok('存下了 true', configSaves[configSaves.length - 1].pullRebase === true)

boxNamed(st, '推送没有上游的分支时直接推上去').props.onChange({ target: { checked: true } })
await wait(5)
fireTimers()
await wait(20)
st = await sectionTree('gp43-net')
console.log('  开了自动上游:', JSON.stringify(commandLine(st)))
ok('打开自动上游：那行说的是 push -u，而不是「由面板问一句」',
  commandLine(st).indexOf('git push -u <remote> <branch>') >= 0 && commandLine(st).indexOf('问一句') < 0)
ok('三个开关都进了同一个配置文件', configSaves[configSaves.length - 1].pushSetUpstream === true)

/* ── 6. 推送没有上游：自己走完，还是问一句 ── */

console.log('')
console.log('== 面板 · 推送没有上游 ==')
const pushCalls = []
let pushSetUpstream = false
const panelSaved = host.call
host.call = function (method, args) {
  if (method === 'git/push') {
    pushCalls.push(args)
    /* 第一次失败在「这个分支没有上游」上；带上 -u 的那一次成功。
       `needsUpstream` 是 Host 判定的那一格（见 10-shell.js 的 `upstreamMissing`）——
       面板不再从 git 那句话里认它，所以这里给的是那格，不是那句话。 */
    if (args != null && args.setUpstream === true) return Promise.resolve({ ok: true, repo: '/tmp/ws', stdout: '', stderr: '', exitCode: 0 })
    return Promise.resolve({ ok: false, needsUpstream: true, repo: '/tmp/ws', stdout: '', stderr: 'fatal: The current branch main has no upstream branch', exitCode: 128 })
  }
  if (method === 'git/refs') {
    return Promise.resolve({
      ok: true, repo: '/tmp/ws', current: ['main'], previous: '',
      local: [{ segments: ['main'], data: 'main' }],
      remote: [{ name: 'origin', remote: 'origin', refs: [{ segments: ['origin', 'main'], data: 'origin/main' }] }],
      /* 配过哪些远端：`git remote` 的答案，横幅上那个名字从这里来。 */
      remoteNames: ['origin'],
    })
  }
  if (method === 'git/config') return Promise.resolve(configReply({ config: Object.assign({}, configNow, { pushSetUpstream: pushSetUpstream }) }))
  return panelSaved(method, args)
}
/* 面板读的是内存里那份插件配置（usePluginConfig 只从 Host 拉一次），所以要改它得走
   设置页自己那扇门：勾一下那个开关。这样「设了之后面板怎么做」测的就是真路径，而不是
   测试往内存里塞一个值。 */
const setPushSetting = async function (on) {
  const t = await sectionTree('gp43-net')
  const box = boxNamed(t, '推送没有上游的分支时直接推上去')
  box.props.onChange({ target: { checked: on } })
  await wait(5)
  fireTimers()
  await wait(20)
  await sectionTree('gp43-net')
}
/* 注意 label：`ready` 是弹层自己「开过一次」之后才为真的，而 fiber 是按 label 认的 ——
   换个 label 渲染就等于重新挂载，`git/refs` 不会发出去，横幅也就永远画不出来（第一版
   就是这么错的）。所以整段都留在 `openPanel` 用的那个 label 上。 */
const clickPush = async function () {
  const t = await openPanel()
  /* 同步组的按钮现在是「记号 + 词」，完整那句在 aria-label 上 */
  const bar = byClass(t, 'dsh-git-sync')[0]
  const btn = buttons(bar === undefined ? t : bar)
    .filter(function (b) { return String(b.props['aria-label']).indexOf('push：推送当前分支') === 0 })[0]
  if (btn !== undefined) btn.props.onClick()
  await wait(30)
  return await settle('pop')
}

await setPushSetting(false)
let pushTree = await clickPush()
console.log('  关着:', JSON.stringify({ 次数: pushCalls.length, 横幅: textOf(pushTree).indexOf('推送并设为上游') >= 0 }))
ok('关着的时候只推一次，然后问一句（原来的行为没变）',
  pushCalls.length === 1 && pushCalls[0].setUpstream === undefined)
ok('横幅还在，读者可以自己按', textOf(pushTree).indexOf('推送并设为上游') >= 0)

pushCalls.length = 0
pushSetUpstream = true
await setPushSetting(true)
pushTree = await clickPush()
console.log('  开着:', JSON.stringify({
  次数: pushCalls.length,
  参数: pushCalls.map(function (a) { return a.setUpstream === true ? 'setUpstream' : 'plain' }),
  横幅: textOf(pushTree).indexOf('推送并设为上游') >= 0,
}))
ok('开着的时候自己走完那一步：第二次带着 -u、远端和分支',
  pushCalls.length === 2 && pushCalls[1].setUpstream === true
  && pushCalls[1].remote === 'origin' && pushCalls[1].branch === 'main')
ok('走完了就不用再问一句', textOf(pushTree).indexOf('推送并设为上游') < 0)
ok('没有第二次重试（-u 那次失败也不会再套一层）', pushCalls.filter(function (a) { return a.setUpstream === true }).length === 1)

host.call = panelSaved

/* ── 7. 没有上游的 pull：和 push 共用一次失败，要补的那一步不同 ── */

console.log('')
console.log('== 面板 · 没有上游的 pull ==')
const pullCalls = []
host.call = function (method, args) {
  if (method === 'git/pull') {
    pullCalls.push(args)
    if (args != null && args.setUpstream === true) return Promise.resolve({ ok: true, repo: '/tmp/ws', stdout: '', stderr: '', exitCode: 0 })
    return Promise.resolve({
      ok: false, needsUpstream: true, repo: '/tmp/ws', stdout: '',
      stderr: 'There is no tracking information for the current branch.', exitCode: 1,
    })
  }
  if (method === 'git/refs') {
    return Promise.resolve({
      ok: true, repo: '/tmp/ws', current: ['main'], previous: '',
      local: [{ segments: ['main'], data: 'main' }], remote: [],
      remoteNames: ['origin'],
    })
  }
  return panelSaved(method, args)
}
/* 同一个 label 渲染才是同一个 fiber：换了 label 就等于重新挂载，`git/refs` 不会发
   出去（push 那一段的注释里已经踩过一次）。所以同步组这颗按钮也照 push 的做法点。 */
const clickSync = async function (aria) {
  const t = await openPanel()
  const bar = byClass(t, 'dsh-git-sync')[0]
  const btn = buttons(bar === undefined ? t : bar)
    .filter(function (b) { return String(b.props['aria-label']).indexOf(aria) === 0 })[0]
  if (btn !== undefined) btn.props.onClick()
  await wait(30)
  return await settle('pop')
}
let pullTree = await clickSync('pull：拉取并合入当前分支')
console.log('  失败之后:', JSON.stringify({ 次数: pullCalls.length, 横幅: textOf(pullTree).indexOf('设为上游') >= 0 }))
ok('pull 在没有上游的分支上失败：横幅给的是「拉取并设为上游」，不是推送那一句',
  pullCalls.length === 1 && textOf(pullTree).indexOf('拉取并设为上游') >= 0
  && textOf(pullTree).indexOf('推送并设为上游') < 0)
ok('横幅里写清了认哪个远端', textOf(pullTree).indexOf('这个分支还没有上游（origin）') >= 0)

const promptBar = byClass(pullTree, 'dsh-git-prompt')[0]
const pullFix = buttons(promptBar === undefined ? pullTree : promptBar)
  .filter(function (b) { return textOf(b).indexOf('拉取并设为上游') >= 0 })[0]
ok('那一行有按钮可以按', pullFix !== undefined)
if (pullFix !== undefined) pullFix.props.onClick()
await wait(30)
const pullAfter = await settle('pop')
console.log('  按下去:', JSON.stringify(pullCalls.map(function (a) { return a.setUpstream === true ? 'setUpstream' : 'plain' })))
ok('按下去带的就是 setUpstream + 远端 + 分支',
  pullCalls.length === 2 && pullCalls[1].setUpstream === true
  && pullCalls[1].remote === 'origin' && pullCalls[1].branch === 'main')
ok('补上之后横幅收起来了', textOf(pullAfter).indexOf('拉取并设为上游') < 0)

/* ── 8. 一个远端都没有的仓库 ──

   `git fetch --all` 在这种仓库里是**成功退出**的，所以这里 Mock 的是 Host 自己那
   一句「没有远端」——它连 git 都没起（见 80-rpc.js 的 `noRemoteReply`）。要测的是：
   面板不再显示成「什么都没发生」，而是把那句话和要跑的命令说出来。 */

console.log('')
console.log('== 面板 · 没有远端 ==')
const lonelyCalls = []
host.call = function (method, args) {
  if (method === 'git/refs') {
    return Promise.resolve({
      ok: true, repo: '/tmp/lonely', current: ['main'], previous: '',
      local: [{ segments: ['main'], data: 'main' }], remote: [], remoteNames: [],
    })
  }
  if (method === 'git/fetch' || method === 'git/pull' || method === 'git/push') {
    lonelyCalls.push(method)
    return Promise.resolve({
      ok: false, repo: '/tmp/lonely', error: 'no-remote', stdout: '', stderr: '',
      exitCode: null, command: '',
    })
  }
  return panelSaved(method, args)
}
const lonelyTree = await clickSync('fetch：从所有远端取回最新引用')
const strip = byClass(lonelyTree, 'dsh-git-error')[0]
const said = strip === undefined ? '' : textOf(strip)
console.log('  面板说:', JSON.stringify(said.slice(0, 60)))
ok('fetch 不再是一个安静的 no-op：面板说出了「这个仓库还没有配置远端」',
  lonelyCalls.indexOf('git/fetch') >= 0 && said.indexOf('这个仓库还没有配置远端') >= 0)
ok('并且给出可以照抄的那条命令', said.indexOf('git remote add origin') >= 0)
ok('这时不画「设上游」的横幅（没有远端可认）', textOf(lonelyTree).indexOf('设为上游') < 0)

host.call = panelSaved
