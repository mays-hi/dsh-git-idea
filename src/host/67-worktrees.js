/* ─────────────── 工作树清单（只读）─────────────── */

/* DSH 0.2 自己会造工作树：模型的 `create_worktree` 走
   `ctx.worktrees.create()`，默认把新树建在**源仓库里面**的
   `.agents/worktrees/<branch>`，然后把会话的生效目录搬过去。这一份读回答两
   个屏幕上的问题：

   1. 这个仓库到底有几棵树、各自在哪、停在哪个分支和提交上、有没有被锁住、
      能不能清理，以及**当前这一份**是哪一棵；
   2. 源仓库的 `git status` 里那条 `.agents/` 未跟踪改动是从哪来的
      —— 那是工作树池，不是读者改出来的东西（客户端用它给那条改动加标记）。

   只读，没有任何写 git 的动作：这里没有 `worktree add/remove/prune/lock`。
   建树、删树、切目录都是 DSH 和模型自己的事，这个插件只把已经发生的事说清楚。

   两个进程一次读：`worktree list --porcelain` 给结构，
   `rev-parse --show-toplevel` 说清哪一份是当前（和 git 自己在一个目录里
   会给出的答案同一个）。每条树的 HEAD 主题由一次 `log --no-walk` 补齐
   —— `--no-walk` 只解引用给出的那几颗提交，不遍历历史，`--ignore-missing`
   让一棵已经被删掉、只剩记录的树（prunable）不至于让整次读失败。 */

const WORKTREE_LIST_MAX = 64

/* Porcelain 是给机器读的格式：一条记录若干行，空行分隔，字段名固定、不翻译。
   这里不做任何猜测式解析 —— 不认识的键直接跳过，将来 git 加了新键也不会把
   这份读弄坏。 */
function parseWorktrees(stdout) {
  const entries = []
  let entry = null
  const flush = function () { if (entry !== null) entries.push(entry); entry = null }
  const lines = stdout.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.length === 0) { flush(); continue }
    const space = line.indexOf(' ')
    const key = space < 0 ? line : line.slice(0, space)
    const rest = space < 0 ? '' : line.slice(space + 1)
    if (key === 'worktree') {
      flush()
      entry = { path: rest, head: '', branch: '', detached: false, locked: false, lockReason: '', prunable: false, pruneReason: '' }
      continue
    }
    if (entry === null) continue
    if (key === 'HEAD') entry.head = rest
    else if (key === 'branch') entry.branch = rest
    else if (key === 'detached') entry.detached = true
    else if (key === 'locked') { entry.locked = true; entry.lockReason = unquoteField(rest) }
    else if (key === 'prunable') { entry.prunable = true; entry.pruneReason = rest }
  }
  flush()
  if (entries.length > WORKTREE_LIST_MAX) entries.length = WORKTREE_LIST_MAX
  return entries
}

/* git 在需要的时候会给一个字段套上双引号（原因里有引号、换行这类"不寻常"的内容
   时一定会）。这里只脱掉最外面那一层：里面的转义序列留着也不影响这是一句话 ——
   这条文本的用途是给人看的提示，不是拿去当参数的路径。 */
function unquoteField(value) {
  const text = String(value)
  if (text.length >= 2 && text.charAt(0) === '"' && text.charAt(text.length - 1) === '"') {
    return text.slice(1, -1)
  }
  return text
}

/* 同一个目录的两种写法：git 在 `worktree list` 里给的是它自己拼的规范路径，
   `rev-parse` 给的是当前进程眼里的路径，Windows 上还可能一个正斜杠一个反斜杠。
   比较之前统一掉尾斜杠和分隔符；只有两边都是盘符路径时才忽略大小写。 */
function sameDir(left, right) {
  const norm = function (value) {
    let text = String(value)
    while (text.length > 1 && (text.charAt(text.length - 1) === '/' || text.charAt(text.length - 1) === '\\')) text = text.slice(0, -1)
    return text.replace(/\\/g, '/')
  }
  const a = norm(left)
  const b = norm(right)
  if (a === b) return true
  const drive = /^[a-zA-Z]:\//
  return drive.test(a) && drive.test(b) && a.toLowerCase() === b.toLowerCase()
}

/* DSH 把工作树池放在源仓库里的默认目录，一个常量。

   这里**故意不去读** `ctx.worktrees` 的配置：那个 `config` 不在服务的公开类型面上
   （声明里是 private），读它等于赌下一个版本还长这个样 —— 而这个插件活下来的方式
   是只依赖说出来的东西。丢掉它也没有损失：池里真的有树时，是 `entries` 里那条
   `rel` 把 `.agents/` 那条折叠改动认出来的（见客户端 `worktreeNote`），这个常量只是
   "池空着/树都被删了"时的兜底。 */
const WORKTREE_POOL_DIR = '.agents/worktrees'

/* `path` 在 `root` 里面时的相对路径，否则空串。用来回答"这条改动是不是
   落在某棵工作树里"。 */
function relativeInside(root, target) {
  if (!isStr(root) || !isStr(target) || root.length === 0 || target.length === 0) return ''
  const norm = function (value) { return String(value).replace(/\\/g, '/').replace(/\/+$/, '') }
  const base = norm(root)
  const full = norm(target)
  if (full === base) return ''
  if (full.length <= base.length + 1) return ''
  if (full.slice(0, base.length) !== base || full.charAt(base.length) !== '/') return ''
  return full.slice(base.length + 1)
}

async function readWorktrees(input, repo) {
  const args = argsFor(input)
  /* `core.quotePath=false`：porcelain 里的路径和锁定原因都走 git 那套 C 风格转义，
     而中文在默认设置下会被转义成八进制（`locked "\\346..."`）。路径要拿去和
     `rev-parse` 的答案比、原因要显示给人看，两边都不该是转义串。 */
  const listed = await gitC(args, ['-c', 'core.quotePath=false', 'worktree', 'list', '--porcelain'], null, { maxBytes: 200000 })
  if (listed.exitCode !== 0) {
    return {
      ok: false, repo: repo === undefined ? null : repo, error: 'not-a-repository',
      /* `stderr` 不带了：这一份读的失败只有三种可行动的说法（没有工作区 / 不是仓库 /
         这台机器没有 git），客户端每种都自己有一句话，git 的原话没人会读。 */
      noGit: gitMissing(listed),
      current: '', pool: WORKTREE_POOL_DIR, entries: [],
    }
  }
  const parsed = parseWorktrees(listed.stdout)
  /* 哪一份是"当前这一份"：git 自己在同一个目录里会给出的那个答案。 */
  let here = ''
  if (repo !== undefined && repo !== null && repo.length > 0) {
    const top = await gitC(args, ['rev-parse', '--show-toplevel'], null, {})
    if (top.exitCode === 0) here = top.stdout.replace(/\r?\n$/, '')
  }
  /* 每颗 HEAD 的短号与主题，一次 log 补齐；同一颗提交只问一次。 */
  const heads = []
  for (let i = 0; i < parsed.length; i += 1) {
    const head = parsed[i].head
    if (head.length > 0 && heads.indexOf(head) < 0) heads.push(head)
  }
  const subjects = {}
  if (heads.length > 0) {
    const logged = await gitC(args, ['--no-pager', 'log', '--no-walk', '--ignore-missing',
      '--format=%H%x1f%h%x1f%s'].concat(heads), null, { maxBytes: 200000 })
    if (logged.exitCode === 0) {
      const rows = logged.stdout.split('\n')
      for (let i = 0; i < rows.length; i += 1) {
        if (rows[i].length === 0) continue
        const fields = rows[i].split('\u001f')
        const full = field(fields, 0)
        if (full.length === 0) continue
        subjects[full] = { short: field(fields, 1), subject: field(fields, 2) }
      }
    }
  }
  const root = repo === undefined || repo === null ? '' : repo
  const entries = []
  for (let i = 0; i < parsed.length; i += 1) {
    const item = parsed[i]
    const name = item.branch.indexOf('refs/heads/') === 0 ? item.branch.slice('refs/heads/'.length) : ''
    const known = subjects[item.head] === undefined ? null : subjects[item.head]
    entries.push({
      path: item.path,
      rel: relativeInside(root, item.path),
      name: name,
      detached: item.detached === true || name.length === 0,
      short: known === null ? '' : known.short,
      subject: known === null ? '' : known.subject,
      locked: item.locked === true,
      lockReason: item.lockReason,
      prunable: item.prunable === true,
      pruneReason: item.pruneReason,
      /* 清单的第一条就是主工作树，这是 git 的承诺（porcelain 文档里写着），不是
         对某个目录名的猜测。 */
      main: i === 0,
      current: here.length > 0 && sameDir(item.path, here),
    })
  }
  return {
    ok: true, repo: listed.cwd,
    /* 这一份读是**从哪棵树**发出来的：面板用它做"当前这一份"那句话的答案，行里的
       `main` 标记说清单第一条是源仓库。没别的了 —— 这里不再自己算一份 `linked`：
       "这个目录是不是链接工作树"由身份读（`worktreeShell` 那一个 `commondir` 判断）
       回答，两处各算一遍只会多一个可能对不上的答案。 */
    current: here.length > 0 ? here : (entries.length > 0 ? entries[0].path : ''),
    pool: WORKTREE_POOL_DIR,
    entries: entries,
  }
}

async function worktreesSnapshot(input) {
  const repo = repoFrom(input, null)
  if (repo === undefined) {
    return { ok: false, repo: null, error: 'no-path', current: '', pool: WORKTREE_POOL_DIR, entries: [] }
  }
  /* 故意不进读缓存：模型建的树，插件没有任何 invalidation 看得见 —— 缓存一份
     "刚才还没有这棵树"的答案是这份读最不该犯的错。两个进程，值得。 */
  return await readWorktrees(input, repo)
}
