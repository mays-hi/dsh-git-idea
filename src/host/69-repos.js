/* ─────────────── 工作区里有哪几个仓库 ─────────────── */

/* 一个工作区常常不止一个仓库：DSH 的会话目录可能是"装着若干项目的那一层"（它自己
   不是仓库），也可能是一个仓库、里面还有别人的检出。插件以前只问一个问题 ——
   `<dir>/.git` 在不在 —— 而且**故意**不向上找父目录、不往里看子目录（见
   62-panel.js 的 `repoHere`）。于是这种工作区在屏幕上只能是一个仓库，或者一个都没
   有；而引导页那条把路径指到其中一个项目的路，一次只能有一个。

   这一份读回答"这个会话的工作区里有哪几个仓库"，**一个进程、纯文件判断**：连一个
   git 进程都不起，所以一台没装 git 的机器上也答得出来（装 git 是之后真正读那几个
   仓库时才需要的事）。

   三条规则写在命令里，都是明说出来的：

   - 工作区**自己**按老规矩算：`-e <dir>/.git` —— 目录或文件都算，链接工作树和子模块
     的 `.git` 是文件；
   - 子孙里只认 `.git` `目录`。`.git` 是文件的那些（子模块、链接工作树）不是"另一个
     仓库"，是某棵树的内部结构：子模块本来就出现在父仓库的改动里，而工作树在面板那颗
     「看哪一个」chip 里有自己的一组（`git/worktrees`，见 67-worktrees.js）；
   - 不往点开头的目录里走（`.git` 自己也在里面），也不走一眼就是产物的目录
     （node_modules、target、dist……）。深度默认 2（`<ws>/a` 与 `<ws>/a/b`），插件
     配置里可以改成 0–3，0 就是"不扫"。

   排序、去重、封顶在 JS 里：shell 只负责把找到的路径连分支名一起吐出来。脚本里没有
   `${}` 展开（参数用 `cut` 取，一次一个进程，只在"真的有东西要找"的那几条路上
   起），所以它可以照原样交给任何一条 POSIX sh —— 包括 Windows 上 Git 自带的那条。 */

const ROOT_SCAN_MAX = 3
const ROOT_COUNT_MAX = 24
const ROOT_LINE_MAX = 400
/* 产物目录：名字就说明它们不是"一个项目"。点开头的目录由那条 `-name '.*'` 一起挡掉。 */
const ROOT_SKIP_DIRS = [
  'node_modules', 'target', 'dist', 'build', 'out', 'bin', 'obj', 'vendor',
  'Pods', 'coverage', 'venv', '__pycache__', 'site-packages',
]

/* 末尾斜杠留着的话，`relativeInside` 那类"这是不是它下面的路径"的判断会把工作区自己
   算成不在自己下面（`/ws/` 与 `/ws`），而 `find` 的输出也会带着那个斜杠。 */
function trimPath(value) {
  let text = String(value)
  while (text.length > 1 && (text.charAt(text.length - 1) === '/' || text.charAt(text.length - 1) === '\\')) text = text.slice(0, -1)
  return text
}

/* 一个目录的分支名，**不经过 git**：HEAD 文件的第一行就是答案。

   `.git` 是文件时（链接工作树、子模块）那一行是 `gitdir: <真正的 gitdir>`，跟着走一步
   就能读到同一份 HEAD —— 相对写法（git 在 `--relative-paths` 下会这么写）按它所在的
   目录补全，盘符写法不乱补。游离 HEAD 留空：那是"没有分支名"，不是"读不动"，调用方
   本来就会把空串画成 HEAD。

   分隔符是**真的制表符**，不是 `\\t` 两个字符：解析那头按制表符切，两边都不经过任何
   转义层。每行用 `printf` 拼好再 `echo` 补换行 —— 路径里的反斜杠（Windows）因此不会
   被哪家的 `echo` 当成转义序列吃掉。 */
function rootsCommand(target, depth) {
  const quoted = shq(target)
  const maxDepth = String(depth + 1)
  /* 「.」开头那一条要把 `.git` 自己排除：它也是点开头的，而它正是要报上去的那一个。 */
  const prune = ROOT_SKIP_DIRS.map(function (name) { return '-name ' + shq(name) + ' -prune' }).join(' -o ')
    + " -o -name '.*' ! -name .git -prune"
  return [
    'd=' + quoted,
    `if [ ! -d "$d" ]; then echo 'K:none'; exit 0; fi`,
    `echo 'K:dir'`,
    `branch_of() {`,
    `  g="$1/.git"`,
    `  if [ -f "$g" ]; then`,
    `    read -r l < "$g"`,
    `    case "$l" in`,
    `      'gitdir: '*) g=$(printf '%s' "$l" | cut -c9-) ;;`,
    `    esac`,
    `    case "$g" in /*|?:/*) ;; *) g="$1/$g" ;; esac`,
    `  fi`,
    `  if [ -f "$g/HEAD" ]; then`,
    `    read -r l < "$g/HEAD"`,
    `    case "$l" in`,
    `      'ref: refs/heads/'*) printf '%s' "$l" | cut -c17- ;;`,
    `    esac`,
    `  fi`,
    `}`,
    `if [ -e "$d/.git" ]; then printf 'R:0\t%s\t%s' "$d" "$(branch_of "$d")"; echo; fi`,
    `find "$d" -mindepth 1 -maxdepth ${maxDepth} ${prune} -o -type d -name .git -print 2>/dev/null | while IFS= read -r g; do`,
    `  p=$(dirname "$g")`,
    `  printf 'G:\t%s\t%s' "$p" "$(branch_of "$p")"; echo`,
    `done`,
  ].join('\n') + '\n'
}

/* 一次扫描的输出：`K:` 说工作区自己是什么，`R:0` 是工作区自己的仓库，`G:` 是子孙里
   找到的每一个。别的行直接跳过 —— 将来 shell 多吐一行也不会把这份读弄坏。 */
function parseRoots(stdout, workspace) {
  const lines = stdout.split('\n')
  const roots = []
  let kind = ''
  let truncated = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.length === 0) continue
    if (line === 'K:dir') { kind = 'dir'; continue }
    if (line === 'K:none') { kind = 'none'; continue }
    if (line === 'K:file') { kind = 'file'; continue }
    if (line.indexOf('R:0\t') === 0) {
      const fields = line.slice(4).split('\t')
      roots.push({ path: trimPath(field(fields, 0)), branch: field(fields, 1), rel: '', depth: 0 })
      continue
    }
    if (line.indexOf('G:\t') !== 0) continue
    if (roots.length >= ROOT_LINE_MAX) { truncated = true; break }
    const fields = line.slice(3).split('\t')
    const path = trimPath(field(fields, 0))
    const rel = relativeInside(workspace, path)
    if (path.length === 0 || rel.length === 0) continue
    /* 一次 find 不会给出同一条路径两次；两棵不同的树可以被 git 自己写成同一个目录
       （同一个目录里既有 `.git` 目录又有别的东西）—— 去重比相信它便宜。 */
    let seen = false
    for (let j = 0; j < roots.length && !seen; j += 1) seen = sameDir(roots[j].path, path)
    if (seen) continue
    roots.push({ path: path, branch: field(fields, 1), rel: rel, depth: rel.split('/').length })
  }
  /* 由近到远、同深度按路径：工作区自己永远是第一条（它就是"这个仓库"的默认），
     子孙里第一个换到的应该是离得最近的那个项目。 */
  roots.sort(function (a, b) {
    if (a.depth !== b.depth) return a.depth - b.depth
    return a.rel < b.rel ? -1 : (a.rel > b.rel ? 1 : 0)
  })
  if (roots.length > ROOT_COUNT_MAX) { roots.length = ROOT_COUNT_MAX; truncated = true }
  return { kind: kind, roots: roots, truncated: truncated }
}

/* 扫描的层数，来自插件配置（`repoScanDepth`，默认 2）。0 是"不扫"：只回答工作区
   自己是不是仓库，一个子目录都不看。 */
async function rootScanDepth() {
  const config = await readConfigFile()
  const value = config != null && typeof config.repoScanDepth === 'number' ? config.repoScanDepth : 0
  if (!(value > 0)) return 0
  return value > ROOT_SCAN_MAX ? ROOT_SCAN_MAX : Math.floor(value)
}

/* ── 这个请求想读的路径，在会话工作区里吗 ──

   插件信任客户端递来的 `repo`（`repoFrom` 里那一个 `input.repo`）。在路径只有"会话
   工作区"一个来源时这是无害的：那个路径本来就是 Host 自己解析出来的。有了仓库清单
   之后情形变了 —— 请求里的路径可以来自别处，而这条通道读的是**整台机器上的仓库**。
   所以这里画一条线：会话工作区自己、它下面的任何路径（引导页手填的路径落在这里），
   以及 git 自己列出来的那几棵工作树 —— 工作树可以建在工作区外面，那是 git 的决定，
   不是越界。

   工作区还不知道（没有会话、也没解析出目录）时一律放行：那正是"路径还没定"的状态，
   拦下来只会让引导页没法让人填第一个路径。 */
function repoOutsideWorkspace(input) {
  const asked = input != null && isStr(input.repo) ? input.repo.trim() : ''
  if (asked.length === 0) return false
  const workspace = sessionWorkdir(input)
  if (!isStr(workspace) || workspace.length === 0) return false
  if (sameDir(workspace, asked)) return false
  if (relativeInside(workspace, asked) !== '') return false
  if (insideKnownWorktree(asked)) return false
  return true
}

/* ── 清单 ──

   按仓库缓存（`cached`，和别的读同一份）：同一个工作区被反复问（chip 每次醒过来、
   面板每次打开）不该反复扫目录。`git/flush` 和这个工作区上任何一次改动都会把它清掉。 */
async function reposSnapshot(input) {
  const depth = await rootScanDepth()
  const fromSession = sessionWorkdir(input)
  const workspace = isStr(fromSession) && fromSession.length > 0 ? fromSession : repoFrom(input)
  if (!isStr(workspace) || workspace.length === 0) {
    return { ok: false, workspace: null, reason: 'no-path', depth: depth, roots: [], truncated: false }
  }
  const target = trimPath(workspace)
  const scanned = await cached(target, 'repos|' + String(depth), function () {
    return probeShell(input, rootsCommand(target, depth)).then(function (probe) {
      return { parsed: parseRoots(probe.stdout, target) }
    })
  })
  const parsed = scanned.parsed
  if (parsed.kind !== 'dir') {
    return { ok: false, workspace: target, reason: parsed.kind === 'file' ? 'file' : 'missing', depth: depth, roots: [], truncated: false }
  }
  return {
    ok: true, workspace: target, depth: depth,
    roots: parsed.roots, truncated: parsed.truncated,
  }
}
