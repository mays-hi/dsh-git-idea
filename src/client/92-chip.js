    /* The last count that was actually measured, per repository. Two sessions
       usually point at the same workspace, and the count is a property of the
       repository, not of the session looking at it — so a session opened for the
       first time can show the number instead of a gap while its own full read
       grinds through the working tree. */
    const pendingByRepo = {}

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

        const apply = function (data) {
          if (data != null && data.ok === true) {
            const branch = text(data.branch)
            const detached = data.detached === true
            const repo = text(data.repo)
            const measured = data.partial !== true
            const counted = data.staged.length + data.unstaged.length + data.untracked.length + data.unmerged.length
            /* The cheap read answers in a fifth of a second and carries no working
               tree at all, so its "no changes" means "not asked", not "nothing to
               report". Counting it dropped the badge to nothing on every poll tick
               — and on a Windows-mounted worktree it stayed gone for the seven
               seconds the full read takes, which reads as the number having been
               lost. What was last measured is kept until something measures it
               again, and `stale` says so out loud, so a stale number is never
               shown as fact. */
            const known = chipLabels[sessionId]
            const remembered = known !== undefined && known.phase === 'repo' && known.repo === repo
            const carried = remembered ? known.pending : (pendingByRepo[repo] !== undefined ? pendingByRepo[repo] : 0)
            if (measured) pendingByRepo[repo] = counted
            const pending = measured ? counted : carried
            /* Kept outside React state because the hover card needs the count and
               hangs in a different subtree; a switch offer should not have to
               re-derive it with another read. */
            chipInfos[sessionId] = { repo: repo, pending: pending }
            prefetchBranches(sessionId, repo.length > 0 ? repo : mine)
            chipLabels[sessionId] = {
              phase: 'repo',
              label: detached ? 'HEAD' : (branch.length > 0 ? branch : 'HEAD'),
              pending: pending,
              /* Only a session that has something to carry is stale: the first
                 visit of a workspace still shows the last count this browser saw
                 for that repository, which is better than a gap that fills in
                 seven seconds later. */
              stale: measured !== true && (remembered || pendingByRepo[repo] !== undefined),
              repo: repo,
              reason: '',
            }
          } else {
            chipInfos[sessionId] = { repo: data != null ? text(data.repo) : '', pending: 0 }
            chipLabels[sessionId] = {
              phase: 'none', label: null, pending: 0,
              repo: data != null ? text(data.repo) : '',
              reason: data != null ? text(data.reason) : '',
            }
          }
          setInfo(chipLabels[sessionId])
        }

        /* Two reads, cheapest first. The identity read answers in about a fifth
           of a second on a repository where the full one takes seven, and it
           carries everything the chip shows except the change count — so the
           workspace you switched to is named immediately and the badge catches
           up. The full read also leaves the Host's cache warm for the panel,
           which is what usually opens next. */
        callHost('git/panel', Object.assign({ quick: true }, request)).then(function (data) {
          if (!alive) return
          apply(data)
          callHost('git/panel', request).then(function (full) {
            if (alive) apply(full)
          }).catch(function () {})
        }).catch(function () {
          if (alive) setInfo({ phase: 'none', label: null, pending: 0, repo: '', reason: '' })
        })
        return function () { alive = false }
      }, [isOpen, sessionId, reloadAt])

      const isRepo = info.phase === 'repo'
      const where = info.repo.length > 0 ? info.repo : '当前会话工作区'
      /* While the cheap read is in flight the count on screen is the last one
         that was measured, so the tooltip says that instead of claiming the
         working tree is clean. */
      const count = info.pending > 0
        ? String(info.pending) + ' 个改动' + (info.stale === true ? '（正在核对）' : '')
        : (info.stale === true ? '正在核对改动…' : '工作区干净')
      let title = 'Git'
      if (info.phase === 'loading') title = 'Git'
      else if (isRepo) title = info.label + ' · ' + info.repo + ' · ' + count
      else if (info.reason === 'missing') title = '目录不存在：' + where + ' —— 点击修改路径'
      else if (info.reason === 'file') title = '这不是一个目录：' + where + ' —— 点击修改路径'
      else if (info.reason === 'empty-dir') title = where + ' 是空目录 —— 点击可在这里初始化仓库'
      else if (info.reason === 'git-error') title = where + ' 读取失败 —— 点击查看原因'
      else if (info.reason === '') title = 'Git —— 点击打开面板'
      else title = where + ' 不在任何 Git 仓库中 —— 点击选择路径或在这里初始化'

      const children = [h(BranchIcon, { key: 'icon', size: 14, plus: !isRepo && info.phase === 'none' })]
      if (isRepo) children.push(h('span', { className: 'dsh-git-chip-label', key: 'label' }, info.label))
      if (isRepo && info.pending > 0) {
        children.push(h('span', {
          className: 'dsh-git-badge' + (info.stale === true ? ' dsh-git-badge-stale' : ''),
          key: 'badge',
        }, String(info.pending)))
      }

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

