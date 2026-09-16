    const SETUP_REASONS = {
      'no-path': { title: '无法确定要查看的仓库路径', hint: '会话工作区未知，请在下面手动填写一个目录。' },
      'missing': { title: '目录不存在', hint: '填写的路径在当前文件系统上找不到。改成一个存在的目录。' },
      'file': { title: '这不是一个目录', hint: '该路径指向一个文件，而 Git 仓库必须是一个目录。' },
      'empty-dir': { title: '这是一个空目录', hint: '里面还没有任何文件 —— 正好可以在这里开始一个新仓库。' },
      'not-a-repo': { title: '不在任何 Git 仓库中', hint: '该目录以及它的所有上级目录都没有 .git。' },
      'git-error': { title: 'git 命令执行失败', hint: '目录存在，但 git 没能读取它。下方是 git 的原话。' },
    }

    function setupReason(id) {
      const found = SETUP_REASONS[id]
      if (found !== undefined) return found
      return { title: '这里还不是 Git 仓库', hint: '' }
    }

    function RepoSetup(props) {
      const plugin = usePluginConfig()
      const [draft, setDraft] = React.useState(props.initial)
      const [armed, setArmed] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [problem, setProblem] = React.useState(null)
      const info = setupReason(props.reason)
      const target = draft.trim()

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

      return h('div', { className: 'gitops-setup' },
        h('div', { className: 'gitops-setup-h' }, info.title),
        h('div', { className: 'gitops-setup-path' }, props.initial.length > 0 ? props.initial : '（没能确定路径）'),
        info.hint.length > 0 ? h('div', { className: 'gitops-hint' }, info.hint) : null,
        props.stderr.length > 0 ? h('div', { className: 'gitops-hint gitops-error gitops-mono' }, props.stderr) : null,
        clearable('path', h('input', {
          className: 'gitops-input',
          placeholder: '仓库目录的绝对路径',
          autoFocus: true,
          value: draft,
          onChange: function (event) { setDraft(event.target.value); setArmed(false) },
          onKeyDown: function (event) { if (event.key === 'Enter') open() },
        }), draft.length > 0, function () { setDraft(''); setArmed(false) }),
        h('div', { className: 'gitops-setup-actions' },
          h('button', {
            type: 'button', className: 'gitops-btn gitops-primary',
            disabled: target.length === 0,
            onClick: open,
          }, '打开这个目录'),
          armed
            ? h('button', {
                type: 'button', className: 'gitops-btn gitops-danger',
                disabled: busy || target.length === 0,
                onClick: doInit,
              }, busy ? '正在初始化…' : '确认初始化（会写入 .git）')
            : h('button', {
                type: 'button', className: 'gitops-btn',
                disabled: busy || target.length === 0,
                onClick: function () { setArmed(true); setProblem(null) },
              }, '在此初始化仓库'),
          armed ? h('button', {
            type: 'button', className: 'gitops-btn',
            disabled: busy,
            onClick: function () { setArmed(false) },
          }, '取消') : null),
        armed ? h('div', { className: 'gitops-hint gitops-danger' },
          '将在 ' + target + ' 下执行 git init' + (plugin.initBranch.length > 0 ? ' -b ' + plugin.initBranch : '') + ' —— 这会创建一个 .git 目录并写入文件，无法通过界面撤销。') : null,
        problem !== null ? h('div', { className: 'gitops-hint gitops-error' }, problem) : null)
    }

