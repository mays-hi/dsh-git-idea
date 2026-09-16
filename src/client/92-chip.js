    function GitChip(props) {
      const isOpen = useOpen()
      const [info, setInfo] = React.useState(function () { return chipLabelFor(props.sessionId) })
      const reloadAt = useDataVersion()
      const sessionId = props.sessionId

      React.useEffect(function () {
        loadSettings(chipNode != null ? chipNode.ownerDocument : null)
        loadPluginConfig()
      }, [])

      /* A new session gets its own remembered label straight away, so the chip
         shows the right workspace's branch while the fresh read is in flight
         instead of the workspace you just left. */
      React.useEffect(function () {
        setInfo(chipLabelFor(sessionId))
      }, [sessionId])

      /* Slow lane: the chip is always on screen but it is not what the user is
         working in, so it may lag the panel. */
      React.useEffect(function () {
        if (gitSettings.watchChip !== true) return undefined
        return watchRepo(sessionRepo(sessionId), sessionId, bumpData, false)
      }, [sessionId, isOpen])

      React.useEffect(function () {
        let alive = true
        const request = { sessionId: sessionId }
        const mine = sessionRepo(sessionId)
        if (mine.length > 0) request.repo = mine
        /* Started before the panel read, so both round trips overlap rather than
           queue: coming back to a workspace you have used should not feel like
           waiting for the branch list twice. */
        prefetchBranches(sessionId, mine)
        callHost('git/panel', request).then(function (data) {
          if (!alive) return
          if (data != null && data.ok === true) {
            const branch = text(data.branch)
            const detached = data.detached === true
            const pending = data.staged.length + data.unstaged.length + data.untracked.length + data.unmerged.length
            /* Kept outside React state because the hover card needs the count and
               hangs in a different subtree; a switch offer should not have to
               re-derive it with another read. */
            chipInfos[sessionId] = { repo: text(data.repo), pending: pending }
            prefetchBranches(sessionId, text(data.repo).length > 0 ? text(data.repo) : mine)
            chipLabels[sessionId] = {
              phase: 'repo',
              label: detached ? 'HEAD' : (branch.length > 0 ? branch : 'HEAD'),
              pending: pending,
              repo: text(data.repo),
              reason: '',
            }
            setInfo(chipLabels[sessionId])
          } else {
            chipInfos[sessionId] = { repo: data != null ? text(data.repo) : '', pending: 0 }
            chipLabels[sessionId] = {
              phase: 'none', label: null, pending: 0,
              repo: data != null ? text(data.repo) : '',
              reason: data != null ? text(data.reason) : '',
            }
            setInfo(chipLabels[sessionId])
          }
        }).catch(function () {
          if (alive) setInfo({ phase: 'none', label: null, pending: 0, repo: '', reason: '' })
        })
        return function () { alive = false }
      }, [isOpen, sessionId, reloadAt])

      const isRepo = info.phase === 'repo'
      const where = info.repo.length > 0 ? info.repo : '当前会话工作区'
      let title = 'Git'
      if (info.phase === 'loading') title = 'Git'
      else if (isRepo) title = info.label + ' · ' + info.repo + (info.pending > 0 ? ' · ' + String(info.pending) + ' 个改动' : ' · 工作区干净')
      else if (info.reason === 'missing') title = '目录不存在：' + where + ' —— 点击修改路径'
      else if (info.reason === 'file') title = '这不是一个目录：' + where + ' —— 点击修改路径'
      else if (info.reason === 'empty-dir') title = where + ' 是空目录 —— 点击可在这里初始化仓库'
      else if (info.reason === 'git-error') title = where + ' 读取失败 —— 点击查看原因'
      else if (info.reason === '') title = 'Git —— 点击打开面板'
      else title = where + ' 不在任何 Git 仓库中 —— 点击选择路径或在这里初始化'

      const children = [h(BranchIcon, { key: 'icon', size: 14, plus: !isRepo && info.phase === 'none' })]
      if (isRepo) children.push(h('span', { className: 'dsh-git-chip-label', key: 'label' }, info.label))
      if (isRepo && info.pending > 0) children.push(h('span', { className: 'dsh-git-badge', key: 'badge' }, String(info.pending)))

      return h('button', {
        type: 'button',
        className: 'dsh-git-chip'
          + (isRepo ? ' dsh-git-chip-repo' : ' dsh-git-chip-idle')
          + (isOpen ? ' dsh-git-chip-open' : ''),
        title: isRepo ? title + ' · 悬停可直接切换分支' : title,
        ref: function (node) { chipNode = node },
        onClick: function () { clearHoverTimer(); setSwitchMode(null); setOpen(!isOpen) },
        /* Hover rather than right-click: the chip already names the branch, so
           hovering it to change it is the shortest path, and a context menu would
           hide a frequent action behind a gesture nothing else here uses. Outside
           a repository there is nothing to switch, so nothing pops up. */
        onPointerEnter: function () {
          if (gitSettings.hoverSwitch === true && isOpen !== true && isRepo === true) hoverOpenSoon()
        },
        onPointerLeave: function () {
          if (switchMode === 'hover') hoverCloseSoon()
        },
      }, children)
    }

