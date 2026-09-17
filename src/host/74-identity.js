/* ─────────────── who a commit is signed by ───────────────

   `git commit` will not write a commit until it knows a name and an address, and
   when it does not it prints eight lines of English advice. The panel used to
   hand those eight lines to the reader; the two `git config` commands inside them
   are the real answer, and this is where the panel offers to run them.

   Read through git and not through the config file: the effective value depends
   on the local file, the global file, the system file, `GIT_AUTHOR_NAME` and the
   command line, in an order only git knows (`git var GIT_AUTHOR_IDENT` is the
   same lookup the commit makes, and it is what `identityMissing` asks). One
   `--show-origin --get-regexp` answers "what is it" and "where did that come
   from" together, which is the pair the settings page has to show: a name that
   comes from `.git/config` is *this repository's*, and one that comes from
   `~/.gitconfig` is the machine's. */

/* The two values, each with the file it came from. `git config` prints
   `file:/path/to/config<TAB>user.name Ada`; the origin prefix is the part that
   says who is winning. */
function parseIdentity(out) {
  const found = { name: '', email: '', nameOrigin: '', emailOrigin: '' }
  const lines = out.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const origin = line.slice(0, tab)
    const rest = line.slice(tab + 1)
    const space = rest.indexOf(' ')
    if (space < 0) continue
    const key = rest.slice(0, space)
    const value = rest.slice(space + 1)
    if (key === 'user.name') { found.name = value; found.nameOrigin = origin }
    if (key === 'user.email') { found.email = value; found.emailOrigin = origin }
  }
  return found
}

/* `file:/home/x/.gitconfig` is what git prints; the reader wants the path. */
function originLabel(origin) {
  if (origin.length === 0) return ''
  if (origin.indexOf('file:') === 0) return origin.slice(5)
  return origin
}

async function identitySnapshot(input) {
  const target = repoFrom(input, null)
  const inside = target !== undefined
  const args = inside ? argsAt(input, target) : {}
  /* 不知道是哪个仓库时，绝不去问「此刻生效的那一份」：`git config`（和 `git var`）
     会按**当前目录**回答，而当前目录是 dsh 进程自己的目录，不是读者在看的东西 ——
     拿它答出来的作者名去填「此刻生效」，就是把另一个仓库的身份说成这个仓库的。这时
     只回答机器级的那一份，并明说不知道仓库（`insideRepo: false`），由界面自己说清。
     这条是被 fixture 抓出来的：临时仓库里读到的 `user.name` 是插件自己仓库里的那个。 */
  const effective = inside
    ? await gitC(args, ['config', '--show-origin', '--get-regexp', '^user\\.(name|email)$'], null, {})
    : null
  /* 机器级的这一份按定义与目录无关，所以它在两种情况下都问。 */
  const global = await gitC(args, ['config', '--global', '--show-origin', '--get-regexp', '^user\\.(name|email)$'], null, {})
  const here = effective === null
    ? { name: '', email: '', nameOrigin: '', emailOrigin: '' }
    : parseIdentity(effective.stdout)
  const machine = parseIdentity(global.stdout)
  /* The same question the commit asks, so the settings page and the commit pane
     can never disagree about whether a commit would be refused. Not asked when
     there is no repository to ask about: "would a commit here be refused" is a
     question about a repository, and answering it from whatever directory the
     Host happens to sit in is the misreport this whole function avoids. */
  const missing = inside ? await identityMissing(args) : false
  return {
    ok: true, repo: inside ? target : null, insideRepo: inside,
    name: inside ? here.name : machine.name,
    email: inside ? here.email : machine.email,
    nameOrigin: inside ? originLabel(here.nameOrigin) : originLabel(machine.nameOrigin),
    emailOrigin: inside ? originLabel(here.emailOrigin) : originLabel(machine.emailOrigin),
    globalName: machine.name, globalEmail: machine.email,
    needsIdentity: missing,
    /* Both halves are the same value from the same file: a name set here but no
       address is the case git reports as "empty ident name", and the page has to
       be able to say which half is missing rather than "fill both". */
    nameMissing: (inside ? here.name : machine.name).length === 0,
    emailMissing: (inside ? here.email : machine.email).length === 0,
  }
}

/* A value about to become one `git config` argument. Quoting is the shell's
   problem (`shq` handles it); what git itself would misread is a leading dash,
   and what would cut a command in half is a control character. */
function cleanIdentValue(value) {
  const raw = isStr(value) ? value : ''
  const trimmed = raw.trim().slice(0, 200)
  if (trimmed.length === 0) return ''
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null
  if (trimmed.charAt(0) === '-') return null
  return trimmed
}

/* Written through git so that everything else on the machine sees it: a terminal,
   IDEA, a hook. The alternative — keeping the pair in this plugin's own config and
   passing `-c user.name=…` to every commit — would make the panel the only tool
   that knows who the author is, which is a worse surprise than the failure it
   fixes.

   `scope` is 'global' (this machine) or 'local' (this repository). Nothing is
   written for a field left empty: `git config user.name ''` is how a reader ends
   up with git's "empty ident name" error in the first place, so an empty box
   means "leave this one alone" rather than "set it to nothing". */
async function identitySave(input) {
  const scope = input != null && input.scope === 'local' ? 'local' : 'global'
  const target = repoFrom(input, null)
  if (scope === 'local' && target === undefined) {
    return { ok: false, error: 'no-path', stderr: '不知道该写进哪个仓库：这个会话没有工作区，也没有指定路径' }
  }
  const name = cleanIdentValue(input != null ? input.name : '')
  const email = cleanIdentValue(input != null ? input.email : '')
  if (name === null || email === null) {
    return { ok: false, error: 'bad-value', stderr: '名字和邮箱里不能有控制字符，也不能以 - 开头' }
  }
  if (name.length === 0 && email.length === 0) {
    return { ok: false, error: 'empty', stderr: '名字和邮箱至少要填一个' }
  }
  const flag = scope === 'local' ? '--local' : '--global'
  /* The sandbox is the session's, and that is decided from `args`: a global write
     has no repository to name, so the session id is what carries the policy. */
  const args = scope === 'local' ? argsAt(input, target) : (input != null && isStr(input.sessionId) ? { sessionId: input.sessionId } : {})
  const written = []
  if (name.length > 0) {
    const one = await git(args, ['config', flag, 'user.name', name], null, {})
    if (one.exitCode !== 0) return { ok: false, error: 'write-failed', field: 'user.name', stderr: one.stderr, stdout: one.stdout, sandboxDenied: one.sandboxDenied === true, noGit: gitMissing(one) }
    written.push('user.name')
  }
  if (email.length > 0) {
    const one = await git(args, ['config', flag, 'user.email', email], null, {})
    if (one.exitCode !== 0) return { ok: false, error: 'write-failed', field: 'user.email', stderr: one.stderr, stdout: one.stdout, sandboxDenied: one.sandboxDenied === true, noGit: gitMissing(one) }
    written.push('user.email')
  }
  /* Read back rather than echo the input: `git config` may have written something
     other than what was typed (a local value being overridden by a higher scope
     is the interesting one), and the page should show what git now answers. The
     read is told which repository to ask about — never left to fall back on the
     Host's own directory (see identitySnapshot). */
  const after = await identitySnapshot({ repo: target, sessionId: input != null ? input.sessionId : undefined })
  return {
    ok: true, scope: scope, written: written, repo: after.repo,
    name: after.name, email: after.email,
    nameOrigin: after.nameOrigin, emailOrigin: after.emailOrigin,
    globalName: after.globalName, globalEmail: after.globalEmail,
    needsIdentity: after.needsIdentity,
  }
}
