
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
ok('工具条给右上角的条数留出了位置', padRight >= 44)
ok('条数绝对定位在右端（不会自己换到第二行）', /\.dsh-git-count\{[^}]*position:absolute/.test(sourceCss))
ok('这条工具栏不再换行（分支名再长也挤不散）', /\.dsh-git-tools\{[^}]*flex-wrap:nowrap/.test(sourceCss))
ok('分组/目录的条数跟在名字后面（不再顶到最右）', /\.dsh-git-tdim\{[^}]*\}/.test(sourceCss) && /\.dsh-git-tdim\{[^}]*margin-left:auto/.test(sourceCss) === false)
ok('筛选触发器可以让位（flex:0 1 auto + min-width:0）', /\.dsh-git-lf\{[^}]*flex:0 1 auto[^}]*min-width:0/.test(sourceCss))
ok('提交操作图标是固定的，不会被挤走', /\.dsh-git-tool-ico\{[^}]*width:26px/.test(sourceCss))
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
console.log('== 分组标题也是一行：单击只选中，双击或点三角才折叠 ==')
/* 分组标题（HEAD / 本地 / 远程）原来是这一棵树里唯一单击就折叠的行：点一下树就动，
   选中却没动，看起来像点错了东西。它现在和目录行同一条规矩。 */
const groupRow = (tree, label) => byClass(tree, 'dsh-git-trow').filter((r) => textOf(r).indexOf(label) >= 0)[0]
const localTitle = groupRow(t, '本地')
ok('本地分组有一行标题，带自己的三角',
  localTitle !== undefined && byClass(localTitle, 'dsh-git-tw').length === 1)
ok('标题行也给了「双击」提示', String(localTitle.props.title).indexOf('双击') > 0)
const beforeTitleClick = graphCalls().length
localTitle.props.onClick()
await wait(15)
t = await settle('pop')
ok('单击标题：这一组的分支行都还在（树没有折）',
  trowWith(t, 'stable') !== undefined && trowWith(t, 'feature') !== undefined)
ok('单击标题：变成这一行选中', String(groupRow(t, '本地').props.className).indexOf('dsh-git-trow-sel') >= 0)
ok('单击标题没有重新读历史', graphCalls().length === beforeTitleClick)
ok('同时只有一行是选中的（分支行让位给标题行）', byClass(t, 'dsh-git-trow-sel').length === 1)

console.log('')
console.log('== 双击标题 / 点三角：这才折叠 ==')
/* 手势要是退回「单击就折叠」，这里不该抛异常，只该是一排 ✗：抛出去会把后面
   所有段落一起带走，回归信号就只剩一个栈。 */
const titleAgain = groupRow(t, '本地')
if (titleAgain !== undefined && typeof titleAgain.props.onDoubleClick === 'function') titleAgain.props.onDoubleClick()
await wait(15)
t = await settle('pop')
ok('双击标题：本地这一组折起来了', trowWith(t, 'stable') === undefined)
ok('折起来之后标题行还在，而且照样是选中的',
  groupRow(t, '本地') !== undefined
  && String(groupRow(t, '本地').props.className).indexOf('dsh-git-trow-sel') >= 0)
let titleTwistyStopped = false
const titleTwisty = byClass(groupRow(t, '本地'), 'dsh-git-tw')[0]
if (titleTwisty !== undefined && typeof titleTwisty.props.onClick === 'function') {
  titleTwisty.props.onClick({ stopPropagation: function () { titleTwistyStopped = true } })
}
await wait(15)
t = await settle('pop')
ok('点三角会拦住冒泡（所以它顺手改不了选中）', titleTwistyStopped)
ok('点三角：这一组又展开了', trowWith(t, 'stable') !== undefined)
ok('点三角之后选中的还是标题行', String(groupRow(t, '本地').props.className).indexOf('dsh-git-trow-sel') >= 0)

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
console.log('== 面板头部：不再有第二个「仓库路径」输入框 ==')
/* 看哪个仓库不是面板的偏好设置，而是会话工作区本身，Host 从会话里取。
   头部再放一个预填着同一个路径的框 + 「应用」，就是把同一件事问两遍。 */
const panelTop = byClass(t, 'dsh-git-top')[0]
console.log('  头部文本:', JSON.stringify(textOf(panelTop)))
ok('头部没有仓库路径框了', byClass(t, 'dsh-git-repo-path').length === 0)
ok('可清除框的那个变体类也一起没了', byClass(t, 'dsh-git-clearable-path').length === 0)
ok('头部一个输入框都不剩', inputs(panelTop).length === 0)
ok('也没有那个「应用」按钮', buttons(panelTop).every((b) => textOf(b) !== '应用'))

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

console.log('')
console.log('== 悬浮与选中：谁的底色说了算 ==')

/* 行是同一个元素：`.dsh-git-crow` 管悬停、`.dsh-git-crow-sel` 管选中，两条规则的
   权重一样（一个类 + 一个伪类），所以谁写在后面谁赢。选中之后再悬浮上去，选中色
   被悬停色顶掉，看起来就像「选中没了」。这里按级联规则算出真正的胜者，而不是只
   看某条规则在不在 —— 写反了顺序也算得出来。 */
const cssFrom = sourceCss.indexOf('.dsh-git-chip{')
const cssText = cssFrom < 0 ? '' : sourceCss.slice(cssFrom, sourceCss.indexOf('`', cssFrom))
ok('拿到了样式表本身', cssText.indexOf('.dsh-git-crow{') > 0)

function cssRules(raw) {
  /* 注释先去掉：它夹在两条规则之间，会被当成选择器的一部分（浏览器不会，
     这里会），结果就是把规则整条跳过 —— 那正是「假绿」的来源。 */
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css)) !== null) out.push({ selectors: m[1].split(',').map((s) => s.trim()), body: m[2] })
  return out
}
function cssTokens(selector) {
  return selector.match(/^[a-z]+|\.[A-Za-z0-9_-]+|::?[a-z-]+/g) || []
}
function cssApplies(selector, classes, hovered) {
  if (/[\s>+~]/.test(selector)) return false
  const tokens = cssTokens(selector)
  if (tokens.length === 0) return false
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.charAt(0) === '.') { if (classes.indexOf(token.slice(1)) < 0) return false }
    else if (token === ':hover') { if (hovered !== true) return false }
    else if (token.charAt(0) === ':') return false
  }
  return true
}
/* 同级里后面的赢，和浏览器一样 */
function cssWinner(css, classes, hovered, property) {
  const rules = cssRules(css)
  let best = null
  for (let i = 0; i < rules.length; i += 1) {
    for (let k = 0; k < rules[i].selectors.length; k += 1) {
      const selector = rules[i].selectors[k]
      if (cssApplies(selector, classes, hovered) !== true) continue
      const decl = rules[i].body.split(';').map((d) => d.trim()).find((d) => d.indexOf(property + ':') === 0)
      if (decl === undefined) continue
      /* 一个类 = 一个伪类 = 一级权重（元素名不算）：所以 hover 那条本来就比
         单纯的 `-sel` 权重高 —— 必须如实算，否则两条都算成 1，靠「后面的赢」
         也能碰巧算对，测出来的就是假的。 */
      const weight = cssTokens(selector).filter((t) => t.charAt(0) === '.' || t.charAt(0) === ':').length
      if (best === null || weight >= best.weight) best = { weight: weight, value: decl.slice(property.length + 1), selector: selector }
    }
  }
  return best
}
const CROW = ['dsh-git-crow']
const CROW_SEL = ['dsh-git-crow', 'dsh-git-crow-sel']
const bg = (classes, hovered) => { const w = cssWinner(cssText, classes, hovered, 'background'); return w === null ? '' : w.value + '   ← ' + w.selector }
console.log('  选中行悬浮:', bg(CROW_SEL, true))
console.log('  选中行静止:', bg(CROW_SEL, false))
console.log('  普通行悬浮:', bg(CROW, true))
ok('选中的行悬浮上去仍然是选中色（悬停色顶不掉它）',
  bg(CROW_SEL, true).indexOf('--dsw-alias-interactive-bg-hover') >= 0)
ok('没悬浮的时候选中行也是选中色', bg(CROW_SEL, false).indexOf('--dsw-alias-interactive-bg-hover') >= 0)
ok('没选中的行悬浮上去还是有悬停色', bg(CROW, true).indexOf('--dsw-alias-bg-layer-2') >= 0)
ok('左侧分支树的行一直是这个规矩（对照）',
  bg(['dsh-git-trow', 'dsh-git-trow-sel'], true).indexOf('--dsw-alias-interactive-bg-hover') >= 0)

/* 切换时图标转圈：只转不改尺寸，所以没有任何布局位移 */
console.log('  转圈的规则:', (cssText.match(/@keyframes dsh-git-spin\{[^}]*\}/) || [''])[0])
ok('转圈是一条 @keyframes 动画，不是靠改尺寸或位置',
  /@keyframes dsh-git-spin\{/.test(cssText) && /\.dsh-git-spin\{[^}]*animation:dsh-git-spin/.test(cssText))

/* ── 清空按钮还活着，只是搬到了唯一还需要它的地方 ──

   头部那个路径框删掉之后，「一个框 + 里面的 ×」只剩说明页在用：路径没能确定
   的时候才需要人填，填错了要能一键清掉。这一段单独放在最后，因为它会把面板
   换成「路径没定」的说明页，后面的段落不能再借用这棵树。 */
console.log('')
console.log('== 说明页上的框仍然一键清空 ==')
const beforeSetupRead = host.call
host.call = function (method, args) {
  if (method === 'git/panel') {
    calls.push({ method: method, args: args })
    return Promise.resolve({
      ok: false, repo: '', error: 'no-session-repo', reason: 'no-path',
      stderr: '', exitCode: 1, staged: [], unstaged: [], untracked: [], unmerged: [],
    })
  }
  return beforeSetupRead(method, args)
}
/* 标签必须和别的段落一样是 'pop'：harness 把根路径也算进 fiber 的键，
   换个标签等于整棵树重新挂载，框里的草稿就没了。面板已经在读一个正常仓库，
   所以先按一下「重新读取」（它会忽略缓存重读，于是读到下面这个 stub）。 */
const refreshBtn = byClass(t, 'dsh-git-tool').filter((b) => String(b.props.title).indexOf('重新读取仓库') === 0)[0]
refreshBtn.props.onClick()
await wait(15)
const setupTree = await settle('pop')
const setupBox = byClass(setupTree, 'dsh-git-clearable')[0]
console.log('  说明页标题:', textOf(byClass(setupTree, 'dsh-git-setup-h')[0]))
ok('路径没定时用的是可清除的框', setupBox !== undefined && inputs(setupBox).length === 1)
ok('空的时候不显示 ×', byClass(setupBox, 'dsh-git-clear-x').length === 0)
inputs(setupBox)[0].props.onChange({ target: { value: '/tmp/other' } })
await wait(5)
const filledTree = await settle('pop')
const filledX = byClass(byClass(filledTree, 'dsh-git-clearable')[0], 'dsh-git-clear-x')[0]
ok('填了内容就出现 ×', filledX !== undefined)
filledX.props.onClick({ stopPropagation() {} })
await wait(5)
const clearedTree = await settle('pop')
ok('点 × 清空了框', inputs(byClass(clearedTree, 'dsh-git-clearable')[0])[0].props.value === '')
host.call = beforeSetupRead


/* ── 图形：虚线，和画到页外的那条线 ──

   过滤后的图形由 Host 按真实 DAG 排（见 Host 那一半的 layoutVisible）：边连到最近
   的**可见**祖先，中间隔着被筛掉的提交时标成虚线；连不到可见祖先的边，画面要把它
   画到**画出来的最后一行底下**，而不是在圆点下面一行就断（以前就是那样，一整屏
   匹配看过去像一排棒棒糖）。这一节把三件事钉在线的形状上：实线没有 dash、虚线有
   dash、离开这一页的线一直画到底。 */
console.log('')
console.log('== 图形：虚线 = 中间有看不见的提交 ==')
const graphSavedCall = host.call
const dashCommits = [
  { hash: 'd1', subject: 'newest match', author: 'mays', date: '2026-09-16', committedAt: nowSec - 10, refs: [] },
  { hash: 'd2', subject: 'second match', author: 'mays', date: '2026-09-15', committedAt: nowSec - 20, refs: [] },
  { hash: 'd3', subject: 'third match', author: 'mays', date: '2026-09-14', committedAt: nowSec - 30, refs: [] },
  { hash: 'd4', subject: 'fourth match', author: 'mays', date: '2026-09-13', committedAt: nowSec - 40, refs: [] },
]
const dashRows = [
  { lane: 0, edges: [{ hash: 'd2', lane: 0 }] },
  { lane: 0, edges: [{ hash: 'd4', lane: 1, dashed: true }] },
  { lane: 1, edges: [{ hash: 'gone', lane: 1, dashed: true }] },
  { lane: 1, edges: [] },
]
host.call = function (method, args) {
  if (method === 'git/graph') {
    return Promise.resolve({ ok: true, repo: '/tmp/ws', ref: 'main', currentBranch: 'main', commits: dashCommits, rows: dashRows, lanes: 2, hasMore: false })
  }
  return graphSavedCall(method, args)
}
graphCommits = dashCommits
/* 上一节把面板留在了「不是仓库」的说明页上，所以这里重新挂载一次；mock 先装好，
   挂载时那一次读拿到的就是上面这份带 rows 的回答。 */
fibers.clear()
fresh = await openPanel()
await wait(15)
fresh = await settle('pop')
host.call = graphSavedCall

const graphSvg = byClass(fresh, 'dsh-git-graph')[0]
const gpaths = graphSvg === undefined ? [] : graphSvg.props.children.filter((n) => n.type === 'path')
const gcircles = graphSvg === undefined ? [] : graphSvg.props.children.filter((n) => n.type === 'circle')
const dOf = (i) => (gpaths[i] === undefined ? '' : String(gpaths[i].props.d))
ok('四条匹配画四个点', gcircles.length === 4)
ok('三条边画三条线', gpaths.length === 3)
ok('相邻的可见父提交：实线（没有 dash）', gpaths[0] !== undefined && gpaths[0].props.strokeDasharray === undefined)
ok('中间藏着看不见的提交：虚线', gpaths[1] !== undefined && gpaths[1].props.strokeDasharray === '3 3')
ok('虚线的弯从自己的道走到父提交那条道（x 10 → 24）',
  dOf(1).indexOf('M 10 ') === 0 && dOf(1).indexOf('24 ') > 0)
ok('连不到可见祖先的边也是虚线', gpaths[2] !== undefined && gpaths[2].props.strokeDasharray === '3 3')
/* 行高 26：最后一行的圆心在 y=91，行底是 117。老写法会停在 91（自己下面一行）。 */
ok('离开这一页的线一直画到画出来的最后一行底下（y=117，而不是 91）',
  dOf(2).indexOf('M 24 65') === 0 && dOf(2).slice(-4) === ' 117')
