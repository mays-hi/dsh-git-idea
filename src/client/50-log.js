    function GraphCanvas(props) {
      const rows = props.rows
      const commits = props.commits
      const laneCount = Math.max(1, props.lanes)
      const width = laneCount * LANE_W + 6
      const height = commits.length * ROW_H
      const rowOf = {}
      for (let i = 0; i < commits.length; i += 1) rowOf[commits[i].hash] = i
      const cx = function (lane) { return lane * LANE_W + LANE_W / 2 + 3 }
      const cy = function (row) { return row * ROW_H + ROW_H / 2 }
      const shapes = []
      for (let i = 0; i < rows.length; i += 1) {
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
      for (let i = 0; i < rows.length; i += 1) {
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
      return h('svg', { className: 'gitops-graph', width: width, height: height }, shapes)
    }

    function CommitList(props) {
      const graph = props.graph
      if (graph == null || graph.ok !== true) {
        const reason = graph != null && graph.error === 'not-a-repository'
          ? ('不是 git 仓库：' + text(graph.repo))
          : '无法读取提交历史'
        return h('div', { className: 'gitops-pane gitops-error' }, reason)
      }
      const commits = graph.commits
      if (commits.length === 0) return h('div', { className: 'gitops-pane gitops-dim' }, '没有匹配的提交')

      const laneNum = Math.max(1, graph.lanes)
      const graphWidth = laneNum * LANE_W + 6
      const listRows = []
      for (let i = 0; i < commits.length; i += 1) {
        const commit = commits[i]
        const refs = splitRefs(commit.refs)
        const chips = []
        for (let k = 0; k < refs.length; k += 1) {
          chips.push(h('span', { className: 'gitops-ref gitops-ref-' + refKind(refs[k]), key: 'r' + k }, refs[k]))
        }
        listRows.push(h('div', {
          className: 'gitops-crow' + (props.selected === commit.hash ? ' gitops-crow-sel' : ''),
          key: commit.hash,
          title: commit.hash + '\n' + commit.subject,
          onClick: function () { props.onPick(commit.hash) },
        },
          h('span', { className: 'gitops-subject' }, commit.subject),
          chips.length > 0 ? h('span', { className: 'gitops-refs' }, chips) : null,
          h('span', { className: 'gitops-author' }, commit.author),
          h('span', { className: 'gitops-date' }, relativeDate(commit.date))))
      }

      return h('div', { className: 'gitops-log' },
        h('div', { className: 'gitops-logwrap', style: { minHeight: (commits.length * ROW_H) + 'px' } },
          h(GraphCanvas, { rows: graph.rows, commits: commits, lanes: graph.lanes }),
          h('div', { style: { marginLeft: graphWidth + 'px' } }, listRows)))
    }

    function RefTree(props) {
      const refs = props.refs
      if (refs == null || refs.ok !== true) return h('div', { className: 'gitops-side gitops-dim' }, '无法读取分支')
      const rows = []

      rows.push(h('div', { className: 'gitops-trow', key: 'head-title', style: { paddingLeft: '6px' },
        onClick: function () { props.onToggle('@head') } },
        h('span', { className: 'gitops-tw' }, props.collapsed['@head'] === true ? '▶' : '▼'),
        h('span', { className: 'gitops-tname gitops-dim' }, 'HEAD（当前分支）')))
      if (props.collapsed['@head'] !== true) {
        if (refs.current.length === 0) {
          rows.push(h('div', { className: 'gitops-trow gitops-dim', key: 'head-none', style: { paddingLeft: '18px' } }, '(游离 HEAD)'))
        } else {
          for (let i = 0; i < refs.current.length; i += 1) {
            const name = refs.current[i]
            rows.push(h('div', {
              className: 'gitops-trow'
                + (props.selectedKey === name ? ' gitops-trow-sel' : '')
                + (props.activeRef === name ? ' gitops-trow-scope' : ''),
              key: 'cur:' + name,
              style: { paddingLeft: '18px' },
              /* Single click only moves the selection: the graph follows on a
                 double click, so browsing the tree never re-reads the history
                 out from under the commit you were reading. */
              title: name + '（双击只看这个分支的历史）',
              onClick: function () { props.onSelect(name) },
              onDoubleClick: function () { props.onSelect(name); props.onPick(name) },
            },
              h('span', { className: 'gitops-tw' }, '★'),
              h('span', { className: 'gitops-tname' }, name)))
          }
        }
      }

      const section = function (title, key, entries) {
        rows.push(h('div', { className: 'gitops-trow', key: key + ':title', style: { paddingLeft: '6px' },
          onClick: function () { props.onToggle(key) } },
          h('span', { className: 'gitops-tw' }, props.collapsed[key] === true ? '▶' : '▼'),
          h('span', { className: 'gitops-tname gitops-dim' }, title),
          h('span', { className: 'gitops-tdim' }, String(entries.length))))
        if (props.collapsed[key] === true) return
        const tree = buildTree(entries)
        const flat = flattenTree(tree, 2, key, props.collapsed, [], key)
        for (let i = 0; i < flat.length; i += 1) {
          const node = flat[i]
          if (node.kind === 'dir') {
            rows.push(h('div', {
              className: 'gitops-trow' + (props.selectedKey === node.id ? ' gitops-trow-sel' : ''),
              key: node.id,
              style: { paddingLeft: (6 + node.depth * 12) + 'px' },
              title: node.name + '（双击展开/折叠）',
              onClick: function () { props.onSelect(node.id) },
              onDoubleClick: function () { props.onToggle(node.path) },
            },
              twisty({ collapsed: node.collapsed, onToggle: function () { props.onToggle(node.path) } }),
              h('span', { className: 'gitops-tname' }, node.name),
              h('span', { className: 'gitops-tdim' }, String(node.count))))
          } else {
            const branchName = text(node.data)
            rows.push(h('div', {
              className: 'gitops-trow'
                + (props.selectedKey === branchName ? ' gitops-trow-sel' : '')
                + (props.activeRef === branchName ? ' gitops-trow-scope' : ''),
              key: node.id,
              style: { paddingLeft: (6 + node.depth * 12) + 'px' },
              title: branchName + '（双击只看这个分支的历史）',
              onClick: function () { props.onSelect(branchName) },
              onDoubleClick: function () { props.onSelect(branchName); props.onPick(branchName) },
            },
              h('span', { className: 'gitops-tw' }),
              h('span', { className: 'gitops-tname' }, node.name)))
          }
        }
      }

      section('本地', '@local', refs.local)
      for (let i = 0; i < refs.remote.length; i += 1) {
        section('远程 · ' + refs.remote[i].name, '@remote:' + refs.remote[i].name, refs.remote[i].refs)
      }
      return h('div', { className: 'gitops-side' }, rows)
    }

