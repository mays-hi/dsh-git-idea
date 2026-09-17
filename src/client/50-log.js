    function GraphCanvas(props) {
      const rows = props.rows
      const commits = props.commits
      const laneCount = Math.max(1, props.lanes)
      const width = laneCount * LANE_W + 6
      const height = commits.length * ROW_H
      /* Only the rows inside the window are drawn, but their coordinates stay
         absolute, because the svg still spans the whole list: an edge from a
         visible row to a parent far below is still the same curve it was. */
      const first = typeof props.first === 'number' ? props.first : 0
      const last = typeof props.last === 'number' ? Math.min(props.last, rows.length) : rows.length
      /* Rebuilt only when the history itself changes. It used to be built on
         every render, and the graph re-renders on every scroll tick (the window
         edges are its props) — so scrolling a 400-commit history rebuilt a
         400-entry map per frame for the two hashes the window's edges look up. */
      const rowOf = useMemo(function () {
        const map = {}
        for (let i = 0; i < commits.length; i += 1) map[commits[i].hash] = i
        return map
      }, [commits])
      const cx = function (lane) { return lane * LANE_W + LANE_W / 2 + 3 }
      const cy = function (row) { return row * ROW_H + ROW_H / 2 }
      /* Where a line that leaves this list goes: the bottom of the rows that are
         drawn. It used to stop one row under its own dot, which is what made a
         filtered history look like a row of lollipops — every match with a
         parent the filter hid drew a ten-pixel tail and nothing else. */
      const exitY = cy(Math.max(first, last - 1)) + ROW_H
      const shapes = []
      for (let i = first; i < last; i += 1) {
        const row = rows[i]
        for (let k = 0; k < row.edges.length; k += 1) {
          const edge = row.edges[k]
          const target = rowOf[edge.hash]
          const x1 = cx(row.lane)
          const y1 = cy(i)
          const x2 = cx(edge.lane)
          const y2 = target === undefined ? exitY : cy(target)
          const mid = (y1 + y2) / 2
          shapes.push(h('path', {
            key: 'e' + i + '_' + k,
            d: 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + mid + ', ' + x2 + ' ' + mid + ', ' + x2 + ' ' + y2,
            fill: 'none',
            stroke: LANE_COLORS[row.lane % LANE_COLORS.length],
            strokeWidth: 1.6,
            strokeLinecap: 'round',
            /* Dashed means the same thing IDEA means by it: this edge is real,
               but the commits along it are not in the list — a filter hid them
               (see layoutVisible in the Host half). */
            strokeDasharray: edge.dashed === true ? '3 3' : undefined,
          }))
        }
      }
      for (let i = first; i < last; i += 1) {
        shapes.push(h('circle', {
          key: 'n' + i,
          cx: cx(rows[i].lane),
          cy: cy(i),
          r: 3.6,
          fill: LANE_COLORS[rows[i].lane % LANE_COLORS.length],
          stroke: 'var(--dsw-alias-bg-layer-1)',
          strokeWidth: 1.5,
        }))
      }
      return h('svg', { className: 'dsh-git-graph', width: width, height: height }, shapes)
    }
    /* Redrawn only when the history itself changes: picking a commit, hovering a
       row or typing in the filter box does not move a single one of these lines. */
    const GraphCanvasMemo = memo(GraphCanvas)

    /* One commit, as its own component so that picking a commit repaints the two
       rows whose highlight changed instead of every row on screen. `selected` is
       a boolean rather than the picked hash for exactly that reason: the other
       rows' props are then untouched by a new selection. */
    function CommitRow(props) {
      const commit = props.commit
      const refs = splitRefs(commit.refs)
      const chips = []
      for (let k = 0; k < refs.length; k += 1) {
        chips.push(h('span', { className: 'dsh-git-ref dsh-git-ref-' + refKind(refs[k]), key: 'r' + k }, refs[k]))
      }
      return h('div', {
        className: 'dsh-git-crow' + (props.selected === true ? ' dsh-git-crow-sel' : ''),
        title: commit.hash + '\n' + commit.subject,
        onClick: function () { props.onPick(commit.hash) },
      },
        h('span', { className: 'dsh-git-subject' }, commit.subject),
        chips.length > 0 ? h('span', { className: 'dsh-git-refs' }, chips) : null,
        h('span', { className: 'dsh-git-author' }, commit.author),
        h('span', { className: 'dsh-git-date' }, relativeDate(commit.date)))
    }
    const CommitRowMemo = memo(CommitRow)

    function CommitList(props) {
      const graph = props.graph
      const commits = graph != null && graph.ok === true && Array.isArray(graph.commits) ? graph.commits : null
      const count = commits === null ? 0 : commits.length
      /* The window has to be asked for before the two early returns below, or a
         list that is empty on one render and full on the next would change how
         many hooks this component calls. */
      const win = useVirtualWindow('log', count, ROW_H)

      if (commits === null) {
        const reason = graph != null && graph.noGit === true
          ? ('找不到 git：' + text(graph.repo))
          : graph != null && graph.error === 'not-a-repository'
            ? ('不是 git 仓库：' + text(graph.repo))
            : '无法读取提交历史'
        return h('div', { className: 'dsh-git-pane dsh-git-error' }, reason)
      }
      if (count === 0) return h('div', { className: 'dsh-git-pane dsh-git-dim' }, '没有匹配的提交')

      const laneNum = Math.max(1, graph.lanes)
      const graphWidth = laneNum * LANE_W + 6
      const listRows = []
      for (let i = win.first; i < win.last; i += 1) {
        listRows.push(h(CommitRowMemo, {
          key: commits[i].hash,
          commit: commits[i],
          selected: props.selected === commits[i].hash,
          onPick: props.onPick,
        }))
      }

      /* Two spacers carry the rows that are not built, so the scrollbar keeps
         describing the whole history and every built row lands on the pixel it
         would have had. */
      const padTop = win.first * ROW_H
      const padBottom = (count - win.last) * ROW_H
      /* The read stops at a page. When git had one commit more than the page
         asked for, there is more history and the list offers it — the count is
         the honest one, because a repository with ten thousand commits must not
         have to say so in order to be readable. */
      const more = graph.hasMore === true && typeof props.onLoadMore === 'function'
        ? h('div', { key: 'more', className: 'dsh-git-more' },
            h('span', { key: 'n', className: 'dsh-git-dim' }, '已显示 ' + String(count) + ' 条'),
            h('button', {
              key: 'b', type: 'button', className: 'dsh-git-btn', onClick: function () { props.onLoadMore() },
            }, '加载更多'))
        : null
      return h('div', {
        className: 'dsh-git-log',
        ref: win.attach,
        onScroll: win.measure,
      },
        h('div', { className: 'dsh-git-logwrap', style: { minHeight: (count * ROW_H) + 'px' } },
          h(GraphCanvasMemo, { rows: graph.rows, commits: commits, lanes: graph.lanes, first: win.first, last: win.last }),
          h('div', { style: { marginLeft: graphWidth + 'px' } },
            padTop > 0 ? h('div', { key: 'pad-top', style: { height: padTop + 'px' } }) : null,
            listRows,
            padBottom > 0 ? h('div', { key: 'pad-bottom', style: { height: padBottom + 'px' } }) : null)),
        more)
    }

    const NO_COLLAPSE = {}

    function RefTree(props) {
      /* The search box above the tree, where IDEA keeps it. A repository with
         more branches than the pane has rows is the normal case, and without it
         the only way to a branch is the scrollbar. */
      const [query, setQuery] = React.useState('')
      const refs = props.refs
      if (refs == null || refs.ok !== true) return h('div', { className: 'dsh-git-side dsh-git-dim' }, '无法读取分支')

      const needle = query.trim().toLowerCase()
      /* A branch matches on the name its row shows. While a filter is on, the
         tree is forced open: a match hidden inside a folded group is not a
         match, and nobody wants to unfold four groups to find it. */
      const collapsed = needle.length === 0 ? props.collapsed : NO_COLLAPSE
      const matching = function (entries) {
        if (needle.length === 0) return entries
        const out = []
        for (let i = 0; i < entries.length; i += 1) {
          const name = text(entries[i].data)
          if (name.toLowerCase().indexOf(needle) >= 0) out.push(entries[i])
        }
        return out
      }
      /* What the Host knows about each local branch, by name: the HEAD rows show
         the current branch, and it is the one whose standing matters most. */
      const metaOf = {}
      for (let i = 0; i < refs.local.length; i += 1) metaOf[text(refs.local[i].data)] = refs.local[i]
      const badgeOf = function (name) {
        const meta = metaOf[name]
        if (meta === undefined) return []
        const ahead = typeof meta.ahead === 'number' ? meta.ahead : 0
        const behind = typeof meta.behind === 'number' ? meta.behind : 0
        const out = []
        /* IDEA's two marks, and its two colours: a blue down arrow for the
           commits waiting on the remote, a green up arrow for the ones waiting
           to be pushed. The number stays because "three behind" is the question
           people actually have; IDEA answers it in the mouseover only. */
        if (behind > 0) out.push(h('span', { key: 'b', className: 'dsh-git-ab dsh-git-ab-in', title: '落后上游 ' + String(behind) + ' 个提交 —— 需要拉取' }, '↓' + (behind > 99 ? '99+' : String(behind))))
        if (ahead > 0) out.push(h('span', { key: 'a', className: 'dsh-git-ab dsh-git-ab-out', title: '领先上游 ' + String(ahead) + ' 个提交 —— 需要推送' }, '↑' + (ahead > 99 ? '99+' : String(ahead))))
        return out
      }
      const rows = []

      /* ── 分组标题也是一行 ──
         HEAD、本地、远程 · x 都曾经是「单击就折叠」：那是这一棵树里唯一不服从树行
         手势的地方，而它的症状和别处一样 —— 想只选中这一行的人点下去，树动了，选中
         没动，看起来像点错了东西。现在它和目录行共用同一条规矩：单击只选中，双击整行
         或点左边的三角才折叠，三角也用上了目录行那一个（会拦住冒泡，所以点三角不会
         顺手把选中挪过来）。 */
      const groupTitle = function (label, key, count) {
        return h('div', {
          className: 'dsh-git-trow' + (props.selectedKey === key + ':title' ? ' dsh-git-trow-sel' : ''),
          key: key + ':title',
          style: { paddingLeft: '6px' },
          title: label + '（双击展开/折叠）',
          onClick: function () { props.onSelect(key + ':title') },
          onDoubleClick: function () { props.onToggle(key) },
        },
          twisty({ collapsed: collapsed[key] === true, onToggle: function () { props.onToggle(key) } }),
          h('span', { className: 'dsh-git-tname dsh-git-dim' }, label),
          count === undefined ? null : h('span', { className: 'dsh-git-tdim' }, count))
      }

      rows.push(groupTitle('HEAD（当前分支）', '@head'))
      const headNames = matching(refs.current.map(function (name) { return { data: name } })).map(function (entry) { return entry.data })
      if (collapsed['@head'] !== true) {
        if (headNames.length === 0) {
          rows.push(h('div', { className: 'dsh-git-trow dsh-git-dim', key: 'head-none', style: { paddingLeft: '18px' } },
            refs.current.length === 0 ? '(游离 HEAD)' : '没有匹配的分支'))
        } else {
          for (let i = 0; i < headNames.length; i += 1) {
            const name = headNames[i]
            const headMeta = metaOf[name]
            const headTip = [name + '（双击只看这个分支的历史）']
            if (headMeta !== undefined) {
              const ha = typeof headMeta.ahead === 'number' ? headMeta.ahead : 0
              const hb = typeof headMeta.behind === 'number' ? headMeta.behind : 0
              headTip.push(text(headMeta.upstream).length > 0
                ? trackTitle(ha, hb) + ' · ' + text(headMeta.upstream)
                : '没有上游分支')
            }
            if (props.dirty > 0) headTip.push('工作区有 ' + String(props.dirty) + ' 个未提交改动')
            rows.push(h('div', {
              className: 'dsh-git-trow dsh-git-trow-head'
                + (props.selectedKey === name ? ' dsh-git-trow-sel' : '')
                + (props.activeRef === name ? ' dsh-git-trow-scope' : ''),
              key: 'cur:' + name,
              style: { paddingLeft: '18px' },
              /* Single click only moves the selection: the graph follows on a
                 double click, so browsing the tree never re-reads the history
                 out from under the commit you were reading. */
              title: headTip.join('\n'),
              onClick: function () { props.onSelect(name) },
              onDoubleClick: function () { props.onSelect(name); props.onPick(name) },
            },
              h('span', { className: 'dsh-git-tw' }, '★'),
              h('span', { className: 'dsh-git-tname' }, name),
              props.dirty > 0
                ? h('span', { key: 'd', className: 'dsh-git-tdirty', title: String(props.dirty) + ' 个未提交改动' }, '●' + String(props.dirty))
                : null,
              badgeOf(name)))
          }
        }
      }

      const section = function (title, key, entries) {
        const shown = matching(entries)
        rows.push(groupTitle(title, key, needle.length === 0 ? String(entries.length) : String(shown.length)))
        if (collapsed[key] === true) return
        const tree = buildTree(shown)
        const flat = flattenTree(tree, 2, key, collapsed, [], key)
        for (let i = 0; i < flat.length; i += 1) {
          const node = flat[i]
          if (node.kind === 'dir') {
            rows.push(treeDirRow(node, props, String(node.count)))
          } else {
            const branchName = text(node.data)
            /* Looked up by name rather than carried on the leaf: the tree is
               folded and rebuilt on the way to the screen, and only the name
               survives that. */
            const meta = metaOf[branchName] === undefined ? null : metaOf[branchName]
            const ahead = meta != null && typeof meta.ahead === 'number' ? meta.ahead : 0
            const behind = meta != null && typeof meta.behind === 'number' ? meta.behind : 0
            const upstream = meta == null ? '' : text(meta.upstream)
            const when = meta == null ? '' : branchRelative(meta.at)
            /* What the branch is worth knowing at a glance: where it stands
               against its upstream, and — for the branch that is checked out —
               how much is sitting uncommitted in the working tree. Both are
               spelled out in the tooltip, because ↑2 and a bare number are only
               legible once you have been told what they mean. */
            const tip = [branchName + '（双击只看这个分支的历史）']
            if (upstream.length > 0) tip.push(trackTitle(ahead, behind) + ' · ' + upstream)
            else tip.push('没有上游分支')
            if (when.length > 0) tip.push('最后提交 ' + when)
            const onHead = props.headName === branchName
            if (onHead && props.dirty > 0) tip.push('工作区有 ' + String(props.dirty) + ' 个未提交改动')
            rows.push(h('div', {
              className: 'dsh-git-trow'
                + (onHead ? ' dsh-git-trow-head' : '')
                + (props.selectedKey === branchName ? ' dsh-git-trow-sel' : '')
                + (props.activeRef === branchName ? ' dsh-git-trow-scope' : ''),
              key: node.id,
              style: { paddingLeft: (6 + node.depth * 12) + 'px' },
              title: tip.join('\n'),
              onClick: function () { props.onSelect(branchName) },
              onDoubleClick: function () { props.onSelect(branchName); props.onPick(branchName) },
            },
              h('span', { className: 'dsh-git-tw' }),
              h('span', { className: 'dsh-git-tname' }, node.name),
              onHead && props.dirty > 0
                ? h('span', { key: 'd', className: 'dsh-git-tdirty', title: String(props.dirty) + ' 个未提交改动' }, '●' + String(props.dirty))
                : null,
              badgeOf(branchName)))
          }
        }
      }

      section('本地', '@local', refs.local)
      for (let i = 0; i < refs.remote.length; i += 1) {
        section('远程 · ' + refs.remote[i].name, '@remote:' + refs.remote[i].name, refs.remote[i].refs)
      }

      return h('div', { className: 'dsh-git-sidewrap' },
        h('div', { className: 'dsh-git-sidehead' },
          h('span', { key: 'i', className: 'dsh-git-sidehead-ico' }, h(Icon, { name: 'search', size: 12 })),
          h('input', {
            key: 'q', className: 'dsh-git-sidehead-input', placeholder: '搜索分支', value: query,
            onChange: function (event) { setQuery(event.target.value) },
          }),
          query.length > 0 ? h('button', {
            key: 'x', type: 'button', className: 'dsh-git-sidehead-x', title: '清空搜索',
            onClick: function () { setQuery('') },
          }, '×') : null),
        h('div', { className: 'dsh-git-side' }, rows))
    }

