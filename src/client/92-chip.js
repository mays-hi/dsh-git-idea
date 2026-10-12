    /* ── 输入框旁边那个 chip ──

       屏幕上那个数字不是这块地方自己量的，它来自全局那一份工作区读数（10-state.js）。
       一次全树读在这台机器上 8–10s，而且占住整条通道（一次只跑一个处理函数）：每次
       醒过来都量一遍，面板那条 0.3s 的路径读就排在它后面 —— 屏幕上就是「面板反应过来了，
       chip 还没反应过来」。所以这里只做三件事：问身份（0.1–0.4s）、把上次那些脏路径
       重新问一次（0.2s，和面板问的是同一个问题，Host 那边只起一个进程），以及在这份
       读数确实该完整重来一遍时发一次全树读（压后 2 秒，让这次点击的反馈先走）。 */

    /* 全树读压后多久：屏幕上先有这一帧的反馈，再让那条 8–10s 的读去占通道。 */
    const COUNT_FULL_DELAY_MS = 2000

    /* ── 没有仓库时，chip 上写哪两个字 ──

       这一段以前只活在悬浮提示里（"目录不存在：/x/y —— 点击修改路径"），而那是浏览
       器自己弹的框：鼠标不经过就什么都看不到，页面上只剩一颗带加号的 Git 图标。现在
       词就在图标旁边，说清是哪一种，点开就是对应的那一页。 */
    const CHIP_WORDS = {
      'missing': '目录不存在',
      'file': '不是目录',
      'no-git': '没有 git',
      'no-path': '选择目录',
      'not-a-repo': '不是仓库',
      'git-error': '读取失败',
    }
    function chipWord(reason) {
      if (reason === undefined || reason === '') return 'Git'
      return CHIP_WORDS[reason] !== undefined ? CHIP_WORDS[reason] : '读不动'
    }

    function GitChip(props) {
      const isOpen = useOpen()
      const switching = useSwitchingTo()
      /* 会话的生效目录（DSH 0.2 的 `workingDirectory` 投影）：模型把工作目录搬到
         一棵工作树里之后，这个值就变了 —— 它就是"该重新读哪个仓库"的信号。见
         `projectionCwd`。 */
      const sessionDir = projectionCwd(props)
      const [info, setInfo] = React.useState(function () { return chipLabelFor(props.sessionId) })
      const reloadAt = useDataVersion()
      /* 谁写了那份读数都要重画：面板量完一次，chip 上的数字跟着变。 */
      useTreeVersion()
      /* Applying a directory in the panel changes which repository this chip is
         about, and this signal is how the chip hears about it: without the render
         it went on reading — and watching — the workspace it started with. */
      const repoVersion = useRepoApplied()
      const watched = sessionRepo(props.sessionId)
      const sessionId = props.sessionId
      const repo = info.repo.length > 0 ? info.repo : watched
      const record = treeRecord(repo)
      const known = record !== null
      const pending = record === null ? 0 : record.count
      /* 正在核对：这份读数该重新完整量一次，或者那一次正在飞（几秒）。 */
      const due = treeReadDue(repo) === true || treeCountReading(repo) === true

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
        return watchRepo(watched, sessionId, bumpData, false)
      }, [watched, repoVersion, sessionId, isOpen])

      /* 这个页面在哪个会话里 —— chip 一直挂在输入框旁边，所以它是把这件事记下来的
         那个面（设置页是全局的，自己不知道）。放在 effect 里而不是渲染里：渲染期间
         通知订阅者就是渲染期间改别人的 state。 */
      React.useEffect(function () { rememberSession(sessionId) }, [sessionId])

      React.useEffect(function () {
        let alive = true
        let stopFull = null
        const request = { sessionId: sessionId }
        const mine = watched
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
            /* 数字来自全局那一份读数，不是这一次读算出来的：快读（身份）根本不带工作区，
               它的「没有改动」意思是「没问过」。 */
            const pending = treeCount(repo)
            /* Kept outside React state because the hover card needs the count and
               hangs in a different subtree; a switch offer should not have to
               re-derive it with another read. */
            chipInfos[sessionId] = { repo: repo, pending: pending }
            prefetchBranches(sessionId, repo.length > 0 ? repo : mine)
            chipLabels[sessionId] = {
              phase: 'repo',
              label: detached ? 'HEAD' : (branch.length > 0 ? branch : 'HEAD'),
              pending: pending,
              repo: repo,
              reason: '',
              /* 这一份目录是不是一棵链接工作树（Host 从 gitdir 里读出来的，见
                 `worktreeShell`）：是就多一颗标记，让"这个分支在另一棵树上"这件事
                 在圆角按钮上就看得见。 */
              worktree: data.worktree == null ? null : data.worktree,
            }
          } else {
            chipInfos[sessionId] = { repo: data != null ? text(data.repo) : '', pending: 0 }
            chipLabels[sessionId] = {
              phase: 'none', label: null, pending: 0,
              repo: data != null ? text(data.repo) : '',
              reason: data != null ? text(data.reason) : '',
              worktree: null,
            }
          }
          setInfo(chipLabels[sessionId])
        }

        /* 数字怎么来：
           1. 这份读数在这个仓库上还没有过 → 整棵树量一次（不量 chip 上就一个数字都没有）；
           2. 有过、而且上次那些脏路径还在 → 只问那些路径（0.2s）。提交之后那几个文件
              就是这样立刻消失的，而且和面板屏幕上那份快照是同一个问题；
           3. 没有脏路径可以问（上一次量出来是干净的），或者这份读数确实该完整重来一遍
              （fullAt 太旧）→ 整棵树量一次；已经有数字时压后 2 秒，让这次点击的反馈先走。

           一次 bump 意味着仓库动过（引用、索引或 HEAD）：干净的那份读数这时不能继续当
           「现在也干净」用 —— 所以第 3 条也在每次 bump 时成立。 */
        const refreshCount = function (repoNow) {
          const current = treeRecord(repoNow)
          const paths = treeReadPaths(repoNow)
          if (current !== null && paths.length > 0) {
            const finished = treeCountReadStart(repoNow)
            const started = Date.now()
            callHost('git/panel', Object.assign({ paths: paths }, request)).then(function (reply) {
              finished()
              /* 这一次路径读有多贵 —— 贵到一定程度就说明父目录扫进了大树，这个仓库从此
                 收窄成只问那几条路径本身（见 pathsOfInterest）。 */
              pathsReadSpent(repoNow, Math.round(Date.now() - started))
              if (alive !== true || reply == null || reply.ok !== true) return
              publishTreeRead(repoNow, mergePanelStatus(current.status, reply), false, null)
            }, function () { finished() })
          }
          const nothingToAsk = current === null || paths.length === 0
          if (treeReadDue(repoNow) !== true && nothingToAsk !== true) return
          const wholeTree = function () {
            const started = Date.now()
            const finished = treeCountReadStart(repoNow)
            callHost('git/panel', request).then(function (full) {
              finished()
              if (alive !== true || full == null || full.ok !== true) return
              publishTreeRead(repoNow, full, true, Date.now() - started)
            }, function () { finished() })
          }
          /* 没有数字可以报（这个仓库还没量过）：现在就得量，8–10s 也认了。上一次量出来
             是干净的、或者按间隔该完整重来一遍：那次全树读压后 2 秒，让这次点击的反馈
             （分支名、面板那条 0.2s 的路径读）先走。 */
          const defer = current !== null && nothingToAsk !== true
          if (defer !== true) { wholeTree(); return }
          const timer = ctx.get('timer')
          if (timer === undefined) { wholeTree(); return }
          stopFull = timer.timeout(wholeTree, COUNT_FULL_DELAY_MS)
        }

        /* The identity read answers in about a fifth of a second on a repository
           where the full one takes eight, and it carries everything the chip shows
           except the change count — so the workspace you switched to is named
           immediately and the badge follows from the shared reading. */
        callHost('git/panel', Object.assign({ quick: true }, request)).then(function (data) {
          if (alive !== true) return
          apply(data)
          const repoNow = data != null && data.ok === true ? text(data.repo) : ''
          if (repoNow.length === 0) return
          prefetchBranches(sessionId, repoNow)
          refreshCount(repoNow)
        }).catch(function () {
          if (alive === true) setInfo({ phase: 'none', label: null, pending: 0, repo: '', reason: '' })
        })
        return function () { alive = false; if (stopFull !== null) stopFull() }
        /* `sessionDir` 是唯一一个"会话本身动了"的信号：模型 `create_worktree` 或
           `cd` 之后，仓库不会自己动，动了的是会话。少了这一条，chip 会一直指着
           `create_worktree` 之前那个仓库，直到某个别的理由让它重读。 */
      }, [watched, repoVersion, isOpen, sessionId, reloadAt, sessionDir])

      const isRepo = info.phase === 'repo'
      /* 链接工作树：**前面那颗图标自己换**，不在后面再挂一颗。同一份改动在源仓库
         和工作树里是两个不同的工作区，读者要能一眼看出屏幕上这份是哪一个；而第二
         颗图标的代价不只是丑 —— 两个 flex 兄弟读起来像两个按钮，这个 chip 从头到
         尾只有一个按钮（同 `BranchIcon` 里 `plus` 那段：一个字形读起来是一个按钮）。 */
      const worktree = isRepo && info.worktree != null ? info.worktree : null
      /* ── 「还在核对」这件事由**最前面那颗图标**说，不在后面加字 ──

         还没量出来、或者这一份读数该完整重来一遍时（due —— 它含"那一次全树读
         正在飞"），图标转圈；切分支时也转（同一个动作，读者不用分两种画法）。
         于是屏幕上只剩下「分支名 + 数字」：转与不转，就是"还在核对"和"核对过了"
         的区别。这比在后面长出一段「正在核对…」好 —— 后面那段字还会把分支名往
         左边挤（见截图里那一条 chip）。

         数字来自全局那一份读数，而不是这次快读 —— 快读根本不带工作区；没量出来
         和没改动是两件事，所以没量出来时也不谎称「干净」，只是那颗图标在转。 */
      const reading = isRepo === true && (known !== true || due === true)
      const spinning = switching !== null || reading

      /* 前面那一格：忙的时候是那个转圈的圆环，忙完换回该出现的那一颗 —— 在链接
         工作树里是工作树字形（VS Code 的 codicon），否则是分支图标，以及它在"这个
         目录还不是仓库"时才画的那一笔 plus。 */
      const children = [spinning
        ? h(SpinnerIcon, { key: 'icon', size: 14 })
        : (worktree === null
            ? h(BranchIcon, {
                key: 'icon', size: 14, plus: !isRepo && info.phase === 'none',
              })
            : h(WorktreeIcon, { key: 'icon', size: 14 }))]
      children.push(h('span', { className: 'dsh-git-chip-label', key: 'label' }, isRepo ? info.label : chipWord(info.reason)))
      if (isRepo && known === true && pending > 0) {
        children.push(h('span', {
          className: 'dsh-git-badge' + (due === true ? ' dsh-git-badge-stale' : ''),
          key: 'badge',
        }, String(pending)))
      }
      return h('button', {
        type: 'button',
        className: 'dsh-git-chip'
          + (isRepo ? ' dsh-git-chip-repo' : ' dsh-git-chip-idle')
          + (isOpen ? ' dsh-git-chip-open' : ''),
        /* 一句话进 aria-label：读屏听得到，页面上不弹框 —— 图标转圈这件事也得说出来，
           不然它只对看得见的人存在。 */
        'aria-label': (isRepo ? info.label : chipWord(info.reason))
          + (switching !== null ? '（正在切换分支）' : (reading === true ? '（正在核对改动）' : ''))
          + ' —— 点击打开 Git 面板',
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

