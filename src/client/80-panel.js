    function GitPanel(props) {
      const plugin = usePluginConfig()
      const sessionId = props.sessionId
      const switcher = useSwitchMode()
      const [tab, setTab] = React.useState('log')
      const [repoPath, setRepoPath] = React.useState(sessionRepo(sessionId))
      const [appliedRepo, setAppliedRepo] = React.useState(sessionRepo(sessionId))
      const [refs, setRefs] = React.useState(null)
      const [authors, setAuthors] = React.useState(null)
      const [graph, setGraph] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [work, setWork] = React.useState(null)
      const [message, setMessage] = React.useState('')
      const [selected, setSelected] = React.useState(null)
      const [selectedKey, setSelectedKey] = React.useState(null)
      const [activeRef, setActiveRef] = React.useState('')
      const [allRefs, setAllRefs] = React.useState(false)
      const [searchDraft, setSearchDraft] = React.useState('')
      const [search, setSearch] = React.useState('')
      const [author, setAuthor] = React.useState('')
      const [datePreset, setDatePreset] = React.useState('all')
      const [pathDraft, setPathDraft] = React.useState('')
      const [pathFilter, setPathFilter] = React.useState('')
      const [collapsed, setCollapsed] = React.useState({})
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      /* Shared with the chip and the switcher rather than local: a switch made
         from the hover card happens while this panel is hidden, and it must not
         come back to the foreground still showing the branch it used to be on. */
      const reloadAt = useDataVersion()
      const [size, setSize] = React.useState(panelSize)
      const [armed, setArmed] = React.useState('')
      const [prompt, setPrompt] = React.useState(null)
      const [needsUpstream, setNeedsUpstream] = React.useState(false)

      /* work is the only truth about whether this path is a usable repository.
         Everything that reads refs, history or the index is gated on it, so a
         non-repository shows one purposeful setup page instead of three panes
         that each report a different flavour of failure. */
      const repoOk = work != null && work.ok === true
      const needsSetup = work != null && work.ok !== true

      const base = function (repo) {
        const request = { sessionId: sessionId }
        if (repo.length > 0) request.repo = repo
        return request
      }

      const loadWork = function (repo) {
        host.call('git/panel', base(repo)).then(function (data) {
          setWork(data)
        }).catch(function (failure) {
          setError(failureText(failure))
        })
      }

      const resetFilters = function () {
        setActiveRef('')
        setAllRefs(false)
        setSearch('')
        setSearchDraft('')
        setAuthor('')
        setDatePreset('all')
        setPathDraft('')
        setPathFilter('')
      }

      const applyRepo = function (next) {
        rememberRepo(sessionId, next)
        setAppliedRepo(next)
        resetFilters()
        setSelected(null)
        setSelectedKey(null)
        setDetail(null)
      }

      const bump = bumpData

      /* ── what a hidden panel costs ──

         The panel stays mounted when it is closed, so a change in the repository
         used to make it re-read the history, the author list, the refs and the
         commit detail while nobody was looking — and then re-render a few hundred
         rows it was about to show anyway. Every one of those reads is cheap when
         the Host cache is warm, but the re-render is not, and none of it was
         visible.

         So a hidden panel does not re-read: it keeps the version it last
         rendered, and the moment it becomes visible again its reads jump to the
         current version and run once, in one pass. Opening a panel that owes
         nothing costs no request and no re-render at all. */
      const [rendered, setRendered] = React.useState(reloadAt)
      const freshAt = props.active === true ? reloadAt : rendered
      React.useEffect(function () {
        if (props.active === true && rendered !== reloadAt) setRendered(reloadAt)
        return undefined
      }, [props.active, reloadAt, rendered])

      /* Refresh has to actually re-read. The Host memoises reads per repository,
         so the button first drops that repository's cached entries and only then
         bumps the counter every read effect below depends on. Without the flush
         it would repaint stale data and look like nothing happened. */
      const refresh = function () {
        setArmed('')
        host.call('git/flush', base(appliedRepo)).then(bump, bump)
      }

      /* One path for every panel operation. A failed operation still re-reads,
         because the failures that matter — a conflicting cherry-pick, merge or
         revert — leave the repository in a different state than they found it. */
      const runOp = function (method, payload) {
        if (busy) return
        setBusy(true)
        setArmed('')
        setError(null)
        setNeedsUpstream(false)
        const request = base(appliedRepo)
        if (payload != null) Object.assign(request, payload)
        rpc(method, request).then(function () {
          setBusy(false)
          bump()
        }, function (failure) {
          setBusy(false)
          setError(failureText(failure))
          if (method === 'git/push' && failureText(failure).indexOf('upstream') >= 0) setNeedsUpstream(true)
          bump()
        })
      }

      const startDrag = function (axis) {
        return function (event) {
          if (event.button != null && event.button !== 0) return
          event.preventDefault()
          event.stopPropagation()
          const node = panelNode
          if (node == null) return
          const doc = node.ownerDocument
          const view = doc != null ? doc.defaultView : null
          const startX = event.clientX
          const startY = event.clientY
          const startW = node.offsetWidth
          const startH = node.offsetHeight
          const maxW = view != null ? view.innerWidth - 24 : 2400
          const maxH = view != null ? view.innerHeight - 24 : 1600
          const clampW = function (value) { return Math.round(value < 420 ? 420 : (value > maxW ? maxW : value)) }
          const clampH = function (value) { return Math.round(value < 220 ? 220 : (value > maxH ? maxH : value)) }
          const onMove = function (move) {
            const next = { w: panelSize.w, h: panelSize.h }
            /* the panel stays centred, so one pixel of edge travel is two pixels
               of width */
            if (axis === 'w' || axis === 'e' || axis === 'nw' || axis === 'ne') {
              const delta = (axis === 'e' || axis === 'ne' ? move.clientX - startX : startX - move.clientX) * 2
              next.w = clampW(startW + delta)
            }
            if (axis === 'n' || axis === 'nw' || axis === 'ne') {
              next.h = clampH(startH + (startY - move.clientY))
            }
            publishPanelSize(next)
          }
          const onUp = function () {
            if (doc != null) {
              doc.removeEventListener('pointermove', onMove)
              doc.removeEventListener('pointerup', onUp)
              doc.removeEventListener('pointercancel', onUp)
            }
            savePanelSize(doc)
          }
          if (doc != null) {
            doc.addEventListener('pointermove', onMove)
            doc.addEventListener('pointerup', onUp)
            doc.addEventListener('pointercancel', onUp)
          }
        }
      }

      const submitPrompt = function () {
        if (prompt == null) return
        const value = prompt.value.trim()
        if (value.length === 0) return
        const kind = prompt.kind
        const at = selected !== null ? selected : ''
        setPrompt(null)
        if (kind === 'tag') runOp('git/tag', { name: value, at: at })
        else runOp('git/branch-create', { name: value, at: at })
      }

      React.useEffect(function () {
        if (!repoOk || props.ready !== true) return undefined
        let alive = true
        host.call('git/refs', base(appliedRepo)).then(function (data) {
          if (alive) setRefs(data)
        }).catch(function (failure) {
          if (alive) setError(failureText(failure))
        })
        return function () { alive = false }
      }, [appliedRepo, repoOk, freshAt, props.ready])

      /* shortlog walks the entire history, so it is deferred until the history
         tab can actually show the author dropdown. The changes tab never needs
         it, and the Host caches it once fetched. */
      React.useEffect(function () {
        if (!repoOk || props.ready !== true || tab !== 'log') return undefined
        let alive = true
        host.call('git/authors', base(appliedRepo)).then(function (data) {
          if (alive) setAuthors(data)
        }).catch(function () {
          if (alive) setAuthors(null)
        })
        return function () { alive = false }
      }, [appliedRepo, repoOk, tab, freshAt, props.ready])

      React.useEffect(function () {
        if (props.ready !== true) return undefined
        loadWork(appliedRepo)
        return undefined
      }, [appliedRepo, tab, freshAt, props.ready])

      React.useEffect(function () {
        if (!repoOk || props.ready !== true || tab !== 'log') return undefined
        let alive = true
        const request = base(appliedRepo)
        request.maxCount = 200
        if (allRefs) request.allRefs = true
        else if (activeRef.length > 0) request.ref = activeRef
        if (search.length > 0) request.search = search
        if (author.length > 0) request.author = author
        const since = dateSince(datePreset)
        if (since.length > 0) request.since = since
        if (pathFilter.length > 0) request.path = pathFilter
        host.call('git/graph', request).then(function (data) {
          if (!alive) return
          setGraph(data)
          /* Nothing is selected until a commit is clicked. Re-reading the history
             keeps whatever was picked if it is still in the new list, and drops it
             otherwise — the list must never pick for the reader. */
          const commits = data != null && data.ok === true && Array.isArray(data.commits) ? data.commits : []
          let keep = ''
          for (let i = 0; i < commits.length; i += 1) {
            if (text(commits[i].hash) === pickedCommit) { keep = pickedCommit; break }
          }
          setSelected(keep.length > 0 ? keep : null)
          if (keep.length === 0) {
            pickedCommit = ''
            setDetail(null)
            return
          }
          const detailRequest = base(appliedRepo)
          detailRequest.hash = keep
          host.call('git/commit-detail', detailRequest).then(function (chosen) {
            if (alive) setDetail(chosen)
          }).catch(function () {})
        }).catch(function (failure) {
          if (alive) setError(failureText(failure))
        })
        return function () { alive = false }
      }, [appliedRepo, activeRef, allRefs, search, author, datePreset, pathFilter, tab, repoOk, freshAt, props.ready])

      /* The panel node exists by the time effects run, so its document is the
         first place a remembered size or preference can be read from. */
      React.useEffect(function () {
        const node = panelNode
        const doc = node != null ? node.ownerDocument : null
        loadPanelSize(doc)
        loadSettings(doc)
        loadPluginConfig()
        if (panelSize.w > 0 || panelSize.h > 0) setSize({ w: panelSize.w, h: panelSize.h })
      }, [])

      /* the settings page can reset the geometry while this panel is open */
      React.useEffect(function () {
        return panelSizeSignal.subscribe(function () {
          setSize({ w: panelSize.w, h: panelSize.h })
        })
      }, [])

      /* The panel watches fast only while it is the thing on screen; closed, it
         falls back to the chip's slow lane and shares that poller. */
      React.useEffect(function () {
        if (!repoOk || props.ready !== true) return undefined
        return watchRepo(appliedRepo, sessionId, bump, props.active === true)
      }, [appliedRepo, repoOk, sessionId, props.active, props.ready])

      /* One identity for as long as the repository does not change: the commit
         rows are memoised, and a handler rebuilt on every render would defeat
         every one of them — including for the rows whose own state did not move. */
      const openCommit = useCallback(function (hash) {
        setSelected(hash)
        pickedCommit = hash
        const request = base(appliedRepo)
        request.hash = hash
        rpc('git/commit-detail', request).then(function (data) {
          setDetail(data)
        }, function (failure) {
          setError(failureText(failure))
        })
      }, [appliedRepo, sessionId])

      const toggle = function (path) {
        setCollapsed(function (previous) {
          const next = Object.assign({}, previous)
          if (next[path] === true) delete next[path]
          else next[path] = true
          return next
        })
      }

      const setStaged = function (files, staged) {
        if (files.length === 0) return
        const paths = []
        for (let i = 0; i < files.length; i += 1) paths.push(files[i].path)
        setBusy(true)
        const request = base(appliedRepo)
        request.paths = paths
        rpc(staged ? 'git/stage' : 'git/unstage', request).then(function () {
          setBusy(false)
          setError(null)
          loadWork(appliedRepo)
        }, function (failure) {
          setBusy(false)
          setError(failureText(failure))
        })
      }

      const changes = work != null && work.ok === true ? mergeChanges(work) : []
      let stagedCount = 0
      for (let i = 0; i < changes.length; i += 1) if (changes[i].staged === true) stagedCount += 1

      const setStagedAll = function () {
        setStaged(changes, stagedCount === 0)
      }

      const commit = function () {
        setBusy(true)
        const request = base(appliedRepo)
        request.message = message.trim()
        if (stagedCount === 0) request.stageAll = true
        rpc('git/commit', request, '提交失败').then(function () {
          setBusy(false)
          setError(null)
          setMessage('')
          loadWork(appliedRepo)
        }, function (failure) {
          setBusy(false)
          setError(failureText(failure))
        })
      }

      const currentBranch = graph != null && graph.ok === true ? text(graph.currentBranch) : (refs != null && refs.ok === true && refs.current.length > 0 ? refs.current[0] : '')
      const branchValue = allRefs ? '@all' : (activeRef.length > 0 ? activeRef : '@current')
      /* Short labels: this select now sits inside an inline "分支：…" trigger, so
         "当前分支（main）" would be the widest thing in the toolbar. */
      /* A native select cannot ellipsize — it cuts the glyph in half — so a long
         branch name is shortened in the label itself, with the full name in the
         option's title. */
      const shortRef = function (name) { return name.length > 12 ? name.slice(0, 11) + '…' : name }
      const branchOptions = [
        { value: '@current', label: '当前' + (currentBranch.length > 0 ? ' ' + shortRef(currentBranch) : ''), title: currentBranch },
        { value: '@all', label: '所有分支', title: '所有分支' },
      ]
      if (refs != null && refs.ok === true) {
        for (let i = 0; i < refs.local.length; i += 1) {
          branchOptions.push({ value: refs.local[i].data, label: shortRef(refs.local[i].data), title: refs.local[i].data })
        }
        for (let i = 0; i < refs.remote.length; i += 1) {
          for (let k = 0; k < refs.remote[i].refs.length; k += 1) {
            branchOptions.push({ value: refs.remote[i].refs[k].data, label: shortRef(refs.remote[i].refs[k].data), title: refs.remote[i].refs[k].data })
          }
        }
      }

      const authorLabels = { '': '作者' }
      const authorOptions = [h('option', { key: '__all', value: '' }, '作者')]
      if (authors != null && authors.ok === true) {
        for (let i = 0; i < authors.authors.length; i += 1) {
          const who = authors.authors[i]
          const value = who.email.length > 0 ? who.email : who.name
          authorLabels[value] = who.name
          authorOptions.push(h('option', {
            key: 'a' + i, value: value, title: who.name + ' · ' + String(who.count) + ' 个提交',
          }, who.name))
        }
      }

      const filterCount = (allRefs || activeRef.length > 0 ? 1 : 0)
        + (author.length > 0 ? 1 : 0)
        + (datePreset !== 'all' ? 1 : 0)
        + (pathFilter.length > 0 ? 1 : 0)
      const hasFilter = filterCount > 0 || search.length > 0
      const commitCount = graph != null && graph.ok === true ? graph.commits.length : 0
      const selectedCommit = selected !== null ? text(selected) : ''
      const canAct = repoOk && busy !== true && selectedCommit.length > 0
      const currentName = refs != null && refs.ok === true && refs.current.length > 0 ? refs.current[0] : ''
      const ahead = work != null && work.ok === true ? work.ahead : 0
      const behind = work != null && work.ok === true ? work.behind : 0
      const sequencer = work != null && work.ok === true ? text(work.sequencer) : ''
      const conflicts = work != null && work.ok === true ? work.unmerged.length : 0

      const tool = function (key, label, title, onClick, options) {
        const opts = options == null ? {} : options
        const classes = ['dsh-git-tool']
        if (opts.danger === true) classes.push('dsh-git-danger')
        if (opts.on === true) classes.push('dsh-git-tool-on')
        /* An icon-only tool: same hit area as the labelled ones, no text. */
        if (opts.ico === true) classes.push('dsh-git-tool-ico')
        const parts = [label]
        if (typeof opts.badge === 'number' && opts.badge > 0) {
          parts.push(h('span', { key: 'b', className: 'dsh-git-tool-badge' }, String(opts.badge)))
        }
        return h('button', {
          key: key, type: 'button', className: classes.join(' '),
          disabled: opts.disabled === true, title: title, onClick: onClick,
        }, parts)
      }

      /* Syncing is a repository-level act, so it belongs in the panel header
         beside the branch it acts on — not in the commit graph's own toolbar,
         which is about the selected commit. The middle toolbar keeps only what
         the selection scopes. */
      const syncGroup = h('div', { className: 'dsh-git-sync' },
        tool('refresh', '⟳', '重新读取仓库（忽略缓存）', refresh, { disabled: !repoOk || busy }),
        tool('fetch', '⇣', 'fetch：从所有远端取回最新引用', function () { runOp('git/fetch') }, { disabled: !repoOk || busy }),
        tool('pull', '↓', 'pull：拉取并合入当前分支', function () { runOp('git/pull') }, { disabled: !repoOk || busy, badge: behind }),
        tool('push', '↑', 'push：推送当前分支', function () { runOp('git/push') }, { disabled: !repoOk || busy, badge: ahead }))

      const branchTitle = (currentName.length > 0 ? currentName : 'HEAD')
        + (ahead > 0 ? ' · 领先 ' + String(ahead) : '')
        + (behind > 0 ? ' · 落后 ' + String(behind) : '')
      /* The branch chip is the switcher's handle: the name is already the thing
         the eye goes to, so making it the button saves a trip to the sidebar for
         the most frequent branch operation there is. */
      const branchChip = h('button', {
        key: 'chip', type: 'button',
        className: 'dsh-git-branch-chip' + (switcher === 'panel' ? ' dsh-git-branch-chip-on' : ''),
        title: branchTitle + ' · 点击切换分支',
        onClick: function () { setSwitchMode(switcher === 'panel' ? null : 'panel') },
      },
        h(BranchIcon, { key: 'i', size: 13 }),
        h('span', { key: 'n', className: 'dsh-git-branch-name' }, currentName.length > 0 ? currentName : 'HEAD'),
        ahead > 0 ? h('span', { key: 'a', className: 'dsh-git-ab' }, '↑' + String(ahead)) : null,
        behind > 0 ? h('span', { key: 'b', className: 'dsh-git-ab' }, '↓' + String(behind)) : null)

      /* Inside the header, which spans the panel: the card then starts at the
         panel's left margin however many rows the header wraps to, and there is
         no measured offset to keep in sync. */
      const switchCard = switcher === 'panel'
        ? h('div', {
            key: 'sw', className: 'dsh-git-switch dsh-git-switch-panel',
            /* The same mark the hover card carries. Without it the card counts as
               "the panel behind the switcher", so pressing a branch row dismissed
               the card on pointerdown and the click never reached the row. */
            ref: function (node) { switcherNode = node },
          },
            h(BranchPicker, {
              sessionId: sessionId,
              repo: appliedRepo,
              mode: 'panel',
              dirty: work != null && work.ok === true
                ? work.staged.length + work.unstaged.length + work.untracked.length + work.unmerged.length
                : 0,
              onDone: function () { setSwitchMode(null) },
              onClose: function () { setSwitchMode(null) },
            }))
        : null

      /* The log toolbar follows IDEA's: the commit actions stay where they were,
         then one search box, then every filter as an inline "name: value"
         trigger that clears itself. No bordered select boxes and no second row,
         so the graph keeps the height that row used to cost. */
      const lfCaret = h('span', { key: 'c', className: 'dsh-git-lf-caret' }, h(Icon, { name: 'down', size: 10 }))
      /* A native select is as wide as its WIDEST option, not the value it is
         showing: with the arrow suppressed that left "作者：mays" floating in a
         112px box with the caret and the × parked at the far end. Sizing the
         control to the label it currently displays keeps the three together. */
      const labelWidth = function (label) {
        let w = 0
        for (let i = 0; i < label.length; i += 1) w += label.charCodeAt(i) > 0x2e80 ? 11.5 : 6.3
        /* +6 of slack: a select that is a hair too narrow clips its own text, and
           a clipped branch name is worse than six spare pixels. */
        return Math.min(132, Math.max(16, Math.round(w) + 6))
      }
      const lfWidth = function (label) { return { width: String(labelWidth(label)) + 'px' } }
      const lfClear = function (key, name, onClear) {
        return h('button', {
          key: key, type: 'button', className: 'dsh-git-lf-x', title: '清除' + name + '筛选',
          onClick: function (event) {
            stopEvent(event)
            /* The trigger is a <label> around a <select>: without preventDefault
               the click would also fall through and open the dropdown we are
               clearing. */
            if (event != null && typeof event.preventDefault === 'function') event.preventDefault()
            onClear()
          },
        }, '×')
      }

      const searchBox = h('div', {
        key: 'search', className: 'dsh-git-logsearch',
        title: '按提交信息筛选（字面量匹配），回车生效',
      },
        h('span', { key: 'i', className: 'dsh-git-logsearch-ico' }, h(Icon, { name: 'search', size: 13 })),
        h('input', {
          key: 'q', className: 'dsh-git-logsearch-input',
          placeholder: '搜索提交信息…',
          value: searchDraft,
          onChange: function (event) { setSearchDraft(event.target.value) },
          onKeyDown: function (event) { if (event.key === 'Enter') setSearch(searchDraft.trim()) },
        }),
        /* Shown as soon as there is anything to clear, applied or not: the box
           holds the draft, so an un-applied query is still one click from gone. */
        searchDraft.length > 0 || search.length > 0 ? h('button', {
          key: 'x', type: 'button', className: 'dsh-git-logsearch-x', title: '清空搜索',
          onClick: function () { setSearchDraft(''); setSearch('') },
        }, '×') : null)

      let branchLabel = branchOptions[0].label
      for (let i = 0; i < branchOptions.length; i += 1) {
        if (branchOptions[i].value === branchValue) { branchLabel = branchOptions[i].label; break }
      }
      const branchScoped = allRefs || activeRef.length > 0
      const branchFilter = h('label', {
        key: 'f:branch', className: 'dsh-git-lf dsh-git-lf-on', title: '分支范围：历史只显示这个分支能到达的提交',
      },
        h('span', { key: 'k', className: 'dsh-git-lf-k' }, '分支：'),
        h('select', {
          key: 's', className: 'dsh-git-lf-select', style: lfWidth(branchLabel), value: branchValue,
          onChange: function (event) {
            const next = event.target.value
            setSelectedKey(null)
            if (next === '@all') { setAllRefs(true); setActiveRef('') }
            else if (next === '@current') { setAllRefs(false); setActiveRef('') }
            else { setAllRefs(false); setActiveRef(next) }
          },
        }, branchOptions.map(function (option) {
          return h('option', { key: option.value, value: option.value, title: option.title }, option.label)
        })),
        lfCaret,
        /* × returns the graph to its default scope — the current branch — rather
           than to "everything": that is the view the panel opens with. */
        branchScoped ? lfClear('x', '分支', function () {
          setSelectedKey(null); setAllRefs(false); setActiveRef('')
        }) : null)

      const authorOn = author.length > 0
      const authorFilter = h('label', {
        key: 'f:author', className: 'dsh-git-lf' + (authorOn ? ' dsh-git-lf-on' : ''), title: '作者',
      },
        authorOn ? h('span', { key: 'k', className: 'dsh-git-lf-k' }, '作者：') : null,
        h('select', {
          key: 's', className: 'dsh-git-lf-select', value: author,
          style: lfWidth(authorLabels[author] !== undefined ? authorLabels[author] : '作者'),
          onChange: function (event) { setAuthor(event.target.value) },
        }, authorOptions),
        lfCaret,
        authorOn ? lfClear('x', '作者', function () { setAuthor('') }) : null)

      let dateLabel = '时间'
      for (let i = 0; i < DATE_PRESETS.length; i += 1) {
        if (DATE_PRESETS[i].id === datePreset) dateLabel = DATE_PRESETS[i].id === 'all' ? '时间' : DATE_PRESETS[i].label
      }
      const dateOn = datePreset !== 'all'
      const dateFilter = h('label', {
        key: 'f:date', className: 'dsh-git-lf' + (dateOn ? ' dsh-git-lf-on' : ''), title: '时间范围',
      },
        dateOn ? h('span', { key: 'k', className: 'dsh-git-lf-k' }, '时间：') : null,
        h('select', {
          key: 's', className: 'dsh-git-lf-select', value: datePreset,
          style: lfWidth(dateLabel),
          onChange: function (event) { setDatePreset(event.target.value) },
        }, DATE_PRESETS.map(function (preset) {
          /* Unset reads as the field's own name, the way IDEA's toolbar does. */
          return h('option', { key: preset.id, value: preset.id }, preset.id === 'all' ? '时间' : preset.label)
        })),
        lfCaret,
        dateOn ? lfClear('x', '时间', function () { setDatePreset('all') }) : null)

      const pathOn = pathDraft.length > 0 || pathFilter.length > 0
      const pathFilterNode = h('label', {
        key: 'f:path', className: 'dsh-git-lf' + (pathOn ? ' dsh-git-lf-on' : ''), title: '只看某个路径的历史，回车生效',
      },
        pathOn ? h('span', { key: 'k', className: 'dsh-git-lf-k' }, '路径：') : null,
        h('input', {
          key: 'i', className: 'dsh-git-lf-input',
          /* Grows with what is typed, so a draft never scrolls inside 44px. */
          style: { width: String(Math.min(110, Math.max(pathOn ? 40 : 46, 24 + pathDraft.length * 6))) + 'px' },
          placeholder: pathOn ? '' : '路径',
          value: pathDraft,
          onChange: function (event) { setPathDraft(event.target.value) },
          onKeyDown: function (event) {
            if (event.key === 'Enter') setPathFilter(pathDraft.trim())
            if (event.key === 'Escape') { setPathDraft(''); setPathFilter('') }
          },
        }),
        pathOn ? lfClear('x', '路径', function () { setPathDraft(''); setPathFilter('') }) : null)

      const toolbar = h('div', { className: 'dsh-git-tools' },
        tool('pick', h(Icon, { name: 'pick', size: 15 }), '拣选：cherry-pick，把这个提交应用到当前分支',
          function () {
            runOp('git/sequence', {
              op: 'cherry-pick', action: 'start', target: selectedCommit,
              record: plugin.cherryPickRecord === true,
            })
          },
          { disabled: !canAct, ico: true }),
        tool('revert', h(Icon, { name: 'revert', size: 15 }), '还原：revert，生成一个反向提交来撤销它',
          function () { runOp('git/sequence', { op: 'revert', action: 'start', target: selectedCommit }) },
          { disabled: !canAct, ico: true }),
        tool('tag', h(Icon, { name: 'tag', size: 15 }), '标签：在这个提交上打标签',
          function () { setArmed(''); setPrompt({ kind: 'tag', value: '' }) },
          { disabled: !canAct, ico: true }),
        tool('branch', h(BranchIcon, { size: 15 }), '分支：从这个提交新建分支并切过去',
          function () { setArmed(''); setPrompt({ kind: 'branch', value: '' }) },
          { disabled: !canAct, ico: true }),
        h('span', { key: 'sep', className: 'dsh-git-tsep' }),
        searchBox,
        branchFilter,
        authorFilter,
        dateFilter,
        pathFilterNode,
        filterCount >= 2 ? h('button', {
          key: 'clear', type: 'button', className: 'dsh-git-lclear', title: '清除全部筛选',
          onClick: function () { resetFilters() },
        }, '全部清除') : null,
        h('span', { key: 'count', className: 'dsh-git-count dsh-git-dim' },
          String(commitCount) + (hasFilter ? ' 条匹配' : ' 条')))

      const promptRow = prompt === null ? null : h('div', { className: 'dsh-git-prompt' },
        h('span', { key: 'l', className: 'dsh-git-hint' }, prompt.kind === 'tag' ? '标签名' : '新分支名'),
        clearable('i', h('input', {
          key: 'i', className: 'dsh-git-input', autoFocus: true, value: prompt.value,
          placeholder: prompt.kind === 'tag' ? '例如 v1.0.0' : '例如 feature/login',
          onChange: function (event) { setPrompt({ kind: prompt.kind, value: event.target.value }) },
          onKeyDown: function (event) {
            if (event.key === 'Enter') submitPrompt()
            if (event.key === 'Escape') setPrompt(null)
          },
        }), prompt.value.length > 0, function () { setPrompt({ kind: prompt.kind, value: '' }) }),
        h('button', {
          key: 'ok', type: 'button', className: 'dsh-git-btn dsh-git-primary',
          disabled: prompt.value.trim().length === 0, onClick: submitPrompt,
        }, '创建'),
        h('button', {
          key: 'no', type: 'button', className: 'dsh-git-btn',
          onClick: function () { setPrompt(null) },
        }, '取消'))

      const SEQ_LABELS = { 'cherry-pick': '拣选', 'revert': '还原', 'merge': '合并', 'rebase': '变基' }
      const seqLabel = SEQ_LABELS[sequencer] !== undefined ? SEQ_LABELS[sequencer] : sequencer
      const doAbort = function () {
        setArmed('')
        runOp('git/sequence', { op: sequencer, action: 'abort' })
      }
      const banner = sequencer.length === 0 ? null : h('div', { className: 'dsh-git-banner' },
        h('span', { key: 't', className: 'dsh-git-banner-text' },
          '正在' + seqLabel + '：' + (conflicts > 0 ? String(conflicts) + ' 个文件冲突' : '等待提交')),
        tool('seq-cont', sequencer === 'merge' ? '提交合并' : '继续',
          sequencer === 'merge' ? '冲突解决并暂存后提交这次合并' : '冲突解决并暂存后继续',
          function () { runOp('git/sequence', { op: sequencer, action: 'continue' }) },
          { disabled: busy }),
        sequencer === 'merge' ? null : tool('seq-skip', '跳过', '跳过这个提交',
          function () { runOp('git/sequence', { op: sequencer, action: 'skip' }) },
          { disabled: busy }),
        armed === 'abort'
          ? tool('seq-abort', '确认中止', '放弃本次' + seqLabel + '，回到操作前的状态', doAbort, { disabled: busy, danger: true })
          : tool('seq-abort', '中止', '放弃本次' + seqLabel,
              function () { setArmed('abort') }, { disabled: busy }))

      const upstreamHint = needsUpstream && refs != null && refs.ok === true && refs.remote.length > 0
        ? h('div', { className: 'dsh-git-prompt' },
            h('span', { key: 'l', className: 'dsh-git-hint' }, '这个分支还没有上游'),
            h('button', {
              key: 'u', type: 'button', className: 'dsh-git-btn dsh-git-primary', disabled: busy,
              onClick: function () {
                runOp('git/push', { setUpstream: true, remote: refs.remote[0].name, branch: currentName })
              },
            }, '推送并设为上游'),
            h('button', { key: 'n', type: 'button', className: 'dsh-git-btn', onClick: function () { setNeedsUpstream(false) } }, '忽略'))
        : null

      const shownRef = allRefs ? '' : (activeRef.length > 0 ? activeRef : (graph != null && graph.ok === true ? text(graph.ref) : ''))
      const effectiveSelection = selectedKey !== null ? selectedKey : shownRef

      const header = h('div', { className: 'dsh-git-top' },
        h('span', { className: 'dsh-git-title' }, 'Git'),
        needsSetup
          ? h('span', { className: 'dsh-git-hint' }, '未检测到仓库')
          : h('div', { className: 'dsh-git-tabs' },
              h('button', { type: 'button', className: 'dsh-git-tab' + (tab === 'changes' ? ' dsh-git-tab-on' : ''),
                onClick: function () { setTab('changes') } }, '变更'),
              h('button', { type: 'button', className: 'dsh-git-tab' + (tab === 'log' ? ' dsh-git-tab-on' : ''),
                onClick: function () { setTab('log') } }, '历史')),
        needsSetup ? null : syncGroup,
        needsSetup ? null : branchChip,
        h('span', { key: 'grow', className: 'dsh-git-grow' }),
        needsSetup ? null : clearable('repo', h('input', {
          className: 'dsh-git-input dsh-git-repo-path',
          placeholder: '仓库路径（留空用会话工作区）',
          value: repoPath,
          onChange: function (event) { setRepoPath(event.target.value) },
          onKeyDown: function (event) { if (event.key === 'Enter') applyRepo(repoPath.trim()) },
        }), repoPath.length > 0, function () { setRepoPath(''); applyRepo('') }, 'dsh-git-clearable-path'),
        needsSetup ? null : h('button', { type: 'button', className: 'dsh-git-btn',
          onClick: function () { applyRepo(repoPath.trim()) } }, '应用'),
        switchCard)

      let body
      if (work == null) {
        body = h('div', { className: 'dsh-git-pane dsh-git-dim' }, '正在读取仓库…')
      } else if (needsSetup) {
        body = h(RepoSetup, {
          key: 'setup:' + appliedRepo + '|' + text(work.repo),
          sessionId: sessionId,
          initial: text(work.repo),
          reason: text(work.reason),
          /* git's own stderr only adds information when git itself misbehaved.
             For "no repository here" the explanation above already says it, and
             the raw fatal: line would just be noise. */
          stderr: text(work.reason) === 'git-error' ? text(work.stderr).slice(0, 400) : '',
          onOpen: function (next) {
            applyRepo(next)
            loadWork(next)
          },
        })
      } else if (tab === 'changes') {
        body = h(ChangesPane, {
          work: work,
          collapsed: collapsed,
          busy: busy,
          message: message,
          stagedCount: stagedCount,
          selectedKey: selectedKey,
          onToggle: toggle,
          onSelect: function (key) { setSelectedKey(key) },
          onSetStaged: setStaged,
          onSetStagedAll: setStagedAll,
          onMessage: setMessage,
          onCommit: commit,
        })
      } else {
        body = h('div', { className: 'dsh-git-body' },
          h('div', { className: 'dsh-git-left' },
            h(RefTree, {
              refs: refs, collapsed: collapsed, selectedKey: effectiveSelection,
              onToggle: toggle, onSelect: function (key) { setSelectedKey(key) },
              onPick: function (name) { setAllRefs(false); setActiveRef(name) }, activeRef: shownRef,
            })),
          h('div', { className: 'dsh-git-main' },
            toolbar,
            promptRow,
            upstreamHint,
            h(CommitList, { graph: graph, selected: selected, onPick: openCommit })),
          h(CommitDetail, {
            detail: detail, collapsed: collapsed, selectedKey: selectedKey,
            onToggle: toggle, onSelect: function (key) { setSelectedKey(key) },
          }))
      }

      const popProps = {
        className: 'dsh-git-pop' + (props.active === true ? '' : ' dsh-git-hidden')
          + (switcher === 'panel' ? ' dsh-git-pop-overflow' : ''),
        ref: function (node) { panelNode = node },
      }
      if (size.w > 0) popProps.style = { width: size.w + 'px', left: '50%', right: 'auto', transform: 'translateX(-50%)' }
      if (size.h > 0) popProps.style = Object.assign({}, popProps.style, { height: size.h + 'px' })

      return h('div', popProps,
        h('div', { key: 'gn', className: 'dsh-git-grip dsh-git-grip-n', title: '拖动调整高度', onPointerDown: startDrag('n') }),
        h('div', { key: 'gw', className: 'dsh-git-grip dsh-git-grip-w', title: '拖动调整宽度', onPointerDown: startDrag('w') }),
        h('div', { key: 'ge', className: 'dsh-git-grip dsh-git-grip-e', title: '拖动调整宽度', onPointerDown: startDrag('e') }),
        h('div', { key: 'gnw', className: 'dsh-git-grip dsh-git-grip-nw', title: '拖动调整宽高', onPointerDown: startDrag('nw') }),
        h('div', { key: 'gne', className: 'dsh-git-grip dsh-git-grip-ne', title: '拖动调整宽高', onPointerDown: startDrag('ne') }),
        header,
        banner,
        error !== null ? h('div', { className: 'dsh-git-error', style: { padding: '4px 10px' } }, error) : null,
        body)
    }

