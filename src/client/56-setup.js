    const SETUP_REASONS = {
      'no-path': { heading: '无法确定要查看的仓库路径', hint: '会话工作区未知，请在下面手动填写一个目录。' },
      'missing': { heading: '目录不存在', hint: '填写的路径在当前文件系统上找不到。改成一个存在的目录。' },
      'file': { heading: '这不是一个目录', hint: '该路径指向一个文件，而 Git 仓库必须是一个目录。' },
      /* 路径已经确定，只是这里没有仓库：没有要解释的规则，也没有要填的东西。
         不劝人换目录，也不让人把已经显示在上面的路径再抄一遍。 */
      'not-a-repo': { heading: '这个目录不是 Git 仓库', hint: '', editable: false },
      /* 路径本身没问题，只是它不在这个会话的工作区里面：插件只读会话工作区里的仓库
         （见 Host 的 `repoOutsideWorkspace`）。所以这一页能改 —— 改回工作区里的路径。 */
      'outside': { heading: '这个路径不在会话工作区里', hint: '', editable: true },
      /* 目录是对的，机器上少了东西：这个页面不能改路径，也不能初始化 —— 两件事
         都救不了这个状态，而 `git init` 只会再失败一次。留一个「打开这个目录」
         当作装好 git 之后的重试。 */
      'no-git': {
        heading: '这台机器上找不到 git',
        hint: '上面这个目录本身是仓库，但面板读它、改它都要调用 git。'
          + '装上 git，或让它出现在 dsh 进程的 PATH 里，再点一次「打开这个目录」。',
        editable: false,
        init: false,
      },
      'git-error': { heading: 'git 命令执行失败', hint: '目录存在，但 git 没能读取它。下方是 git 的原话。' },
    }

    function setupReason(id) {
      const found = SETUP_REASONS[id]
      if (found !== undefined) return found
      return { heading: '这里还不是 Git 仓库', hint: '' }
    }

    function RepoSetup(props) {
      const plugin = usePluginConfig()
      const [draft, setDraft] = React.useState(props.initial)
      const [armed, setArmed] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [problem, setProblem] = React.useState(null)
      const info = setupReason(props.reason)
      /* 只有「路径还没定」或「这个路径有问题」时才需要人改路径。
         路径本身没错、只是这里没有仓库时，上面那行已经说清是哪个目录了。 */
      const editable = info.editable !== false
      /* 初始化是「这里还没有仓库」的出路。没有 git 的时候它不是出路，是同一个
         失败再演一次。 */
      const canInit = info.init !== false
      const target = draft.trim()
      /* 「不在工作区里」要说清是哪个工作区：那句提示得带上路径。 */
      const workspace = props.workspace === undefined ? '' : props.workspace
      const hint = props.reason === 'outside' && workspace.length > 0
        ? '这个会话的工作区是 ' + workspace + '。只有它里面的仓库能在这里打开 —— 要读别处的仓库，先让会话切到那个目录。'
        : info.hint
      /* 这个工作区下面扫到的仓库（Host 的 `git/repos`）：不是仓库的目录，第一件想知道的
         就是「那这里面有仓库吗、在哪」。有就一行一个列出来，点一下就是打开它。 */
      const roots = props.roots === undefined || props.roots === null ? [] : props.roots

      const open = function () {
        if (target.length === 0) return
        setArmed(false)
        props.onOpen(target)
      }

      const doInit = function () {
        if (target.length === 0 || busy) return
        setBusy(true)
        setProblem(null)
        const request = { sessionId: props.sessionId, repo: target }
        if (plugin.initBranch.length > 0) request.branch = plugin.initBranch
        rpc('git/init', request, '初始化失败').then(function () {
          setBusy(false)
          setArmed(false)
          props.onOpen(target)
        }, function (failure) {
          setBusy(false)
          setArmed(false)
          setProblem(failureText(failure))
        })
      }

      return h('div', { className: 'dsh-git-setup' },
        h('div', { className: 'dsh-git-setup-h' }, info.heading),
        h('div', { className: 'dsh-git-setup-path' }, props.initial.length > 0 ? props.initial : '（没能确定路径）'),
        hint.length > 0 ? h('div', { className: 'dsh-git-hint' }, hint) : null,
        roots.length === 0 ? null : h('div', { className: 'dsh-git-setup-roots' },
          h('div', { key: 'h', className: 'dsh-git-setup-roots-h' },
            '这个工作区下面找到 ' + String(roots.length) + ' 个仓库'
              + (props.truncated === true ? '（只列出前 ' + String(roots.length) + ' 个）' : '') + '，点一个打开：'),
          roots.map(function (root) {
            const path = text(root.path)
            const label = text(root.rel).length > 0 ? text(root.rel) : path
            const branch = text(root.branch)
            return h('button', {
              key: path, type: 'button', className: 'dsh-git-setup-root',
              'aria-label': '打开 ' + path + (branch.length > 0 ? '（分支 ' + branch + '）' : ''),
              onClick: function () { props.onOpen(path) },
            },
              h('span', { key: 'i', className: 'dsh-git-setup-root-ico' }, h(Icon, { name: 'folder', size: 13 })),
              h('span', { key: 'n', className: 'dsh-git-setup-root-n' }, label),
              branch.length > 0 ? h('span', { key: 'b', className: 'dsh-git-setup-root-b' }, branch) : null,
              h('span', { key: 'p', className: 'dsh-git-setup-root-p' }, path))
          })),
        props.stderr.length > 0 ? h('div', { className: 'dsh-git-hint dsh-git-error dsh-git-mono' }, props.stderr) : null,
        editable ? clearable('path', h('input', {
          className: 'dsh-git-input',
          placeholder: '仓库目录的绝对路径',
          autoFocus: true,
          value: draft,
          onChange: function (event) { setDraft(event.target.value); setArmed(false) },
          onKeyDown: function (event) { if (event.key === 'Enter') open() },
        }), draft.length > 0, function () { setDraft(''); setArmed(false) }) : null,
        h('div', { className: 'dsh-git-setup-actions' },
          h('button', {
            type: 'button', className: 'dsh-git-btn dsh-git-primary',
            disabled: target.length === 0,
            onClick: open,
          }, '打开这个目录'),
          armed
            ? h('button', {
                type: 'button', className: 'dsh-git-btn dsh-git-danger',
                disabled: busy || target.length === 0,
                onClick: doInit,
              }, busy ? '正在初始化…' : '确认初始化（会写入 .git）')
            : (canInit ? h('button', {
                type: 'button', className: 'dsh-git-btn',
                disabled: busy || target.length === 0,
                onClick: function () { setArmed(true); setProblem(null) },
              }, '在此初始化仓库') : null),
          armed ? h('button', {
            type: 'button', className: 'dsh-git-btn',
            disabled: busy,
            onClick: function () { setArmed(false) },
          }, '取消') : null),
        armed ? h('div', { className: 'dsh-git-hint dsh-git-danger' },
          '将在 ' + target + ' 下执行 git init' + (plugin.initBranch.length > 0 ? ' -b ' + plugin.initBranch : '') + ' —— 这会创建一个 .git 目录并写入文件，无法通过界面撤销。') : null,
        problem !== null ? h('div', { className: 'dsh-git-hint dsh-git-error' }, problem) : null)
    }
