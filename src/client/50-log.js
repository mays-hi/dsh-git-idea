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
      const rowOf = {}
      for (let i = 0; i < commits.length; i += 1) rowOf[commits[i].hash] = i
      const cx = function (lane) { return lane * LANE_W + LANE_W / 2 + 3 }
      const cy = function (row) { return row * ROW_H + ROW_H / 2 }
      const shapes = []
      for (let i = first; i < last; i += 1) {
        const row = rows[i]
        for (let k = 0; k < row.edges.length; k += 1) {
          const edge = row.edges[k]
          const target = rowOf[edge.hash]
          const x1 = cx(row.lane)
          const y1 = cy(i)
          const x2 = cx(edge.lane)
          const y2 = target === undefined ? cy(i) + ROW_H : cy(target)
          const mid = (y1 + y2) / 2
          shapes.push(h('path', {
            key: 'e' + i + '_' + k,
            d: 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + mid + ', ' + x2 + ' ' + mid + ', ' + x2 + ' ' + y2,
            fill: 'none',
            stroke: LANE_COLORS[row.lane % LANE_COLORS.length],
            strokeWidth: 1.6,
            strokeLinecap: 'round',
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
        key: commit.hash,
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
        const reason = graph != null && graph.error === 'not-a-repository'
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
            padBottom > 0 ? h('div', { key: 'pad-bottom', style: { height: padBottom + 'px' } }) : null)))
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
      const rows = []

      rows.push(h('div', { className: 'dsh-git-trow', key: 'head-title', style: { paddingLeft: '6px' },
        onClick: function () { props.onToggle('@head') } },
        h('span', { className: 'dsh-git-tw' }, collapsed['@head'] === true ? '▶' : '▼'),
        h('span', { className: 'dsh-git-tname dsh-git-dim' }, 'HEAD（当前分支）')))
      const headNames = matching(refs.current.map(function (name) { return { data: name } })).map(function (entry) { return entry.data })
      if (collapsed['@head'] !== true) {
        if (headNames.length === 0) {
          rows.push(h('div', { className: 'dsh-git-trow dsh-git-dim', key: 'head-none', style: { paddingLeft: '18px' } },
            refs.current.length === 0 ? '(游离 HEAD)' : '没有匹配的分支'))
        } else {
          for (let i = 0; i < headNames.length; i += 1) {
            const name = headNames[i]
            rows.push(h('div', {
              className: 'dsh-git-trow'
                + (props.selectedKey === name ? ' dsh-git-trow-sel' : '')
                + (props.activeRef === name ? ' dsh-git-trow-scope' : ''),
              key: 'cur:' + name,
              style: { paddingLeft: '18px' },
              /* Single click only moves the selection: the graph follows on a
                 double click, so browsing the tree never re-reads the history
                 out from under the commit you were reading. */
              title: name + '（双击只看这个分支的历史）',
              onClick: function () { props.onSelect(name) },
              onDoubleClick: function () { props.onSelect(name); props.onPick(name) },
            },
              h('span', { className: 'dsh-git-tw' }, '★'),
              h('span', { className: 'dsh-git-tname' }, name)))
          }
        }
      }

      const section = function (title, key, entries) {
        const shown = matching(entries)
        rows.push(h('div', { className: 'dsh-git-trow', key: key + ':title', style: { paddingLeft: '6px' },
          onClick: function () { props.onToggle(key) } },
          h('span', { className: 'dsh-git-tw' }, collapsed[key] === true ? '▶' : '▼'),
          h('span', { className: 'dsh-git-tname dsh-git-dim' }, title),
          h('span', { className: 'dsh-git-tdim' }, needle.length === 0 ? String(entries.length) : String(shown.length))))
        if (collapsed[key] === true) return
        const tree = buildTree(shown)
        const flat = flattenTree(tree, 2, key, collapsed, [], key)
        for (let i = 0; i < flat.length; i += 1) {
          const node = flat[i]
          if (node.kind === 'dir') {
            rows.push(h('div', {
              className: 'dsh-git-trow' + (props.selectedKey === node.id ? ' dsh-git-trow-sel' : ''),
              key: node.id,
              style: { paddingLeft: (6 + node.depth * 12) + 'px' },
              title: node.name + '（双击展开/折叠）',
              onClick: function () { props.onSelect(node.id) },
              onDoubleClick: function () { props.onToggle(node.path) },
            },
              twisty({ collapsed: node.collapsed, onToggle: function () { props.onToggle(node.path) } }),
              h('span', { className: 'dsh-git-tname' }, node.name),
              h('span', { className: 'dsh-git-tdim' }, String(node.count))))
          } else {
            const branchName = text(node.data)
            rows.push(h('div', {
              className: 'dsh-git-trow'
                + (props.selectedKey === branchName ? ' dsh-git-trow-sel' : '')
                + (props.activeRef === branchName ? ' dsh-git-trow-scope' : ''),
              key: node.id,
              style: { paddingLeft: (6 + node.depth * 12) + 'px' },
              title: branchName + '（双击只看这个分支的历史）',
              onClick: function () { props.onSelect(branchName) },
              onDoubleClick: function () { props.onSelect(branchName); props.onPick(branchName) },
            },
              h('span', { className: 'dsh-git-tw' }),
              h('span', { className: 'dsh-git-tname' }, node.name)))
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

