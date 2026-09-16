    function ChangesPane(props) {
      const work = props.work
      if (work == null) return h('div', { className: 'gitops-pane gitops-dim' }, '正在读取工作区…')
      if (work.ok !== true) {
        const reason = work.error === 'not-a-repository'
          ? ('不是 git 仓库：' + text(work.repo))
          : '无法读取工作区状态'
        return h('div', { className: 'gitops-pane gitops-error' }, reason)
      }

      const changes = mergeChanges(work)
      const treeEntries = []
      for (let i = 0; i < changes.length; i += 1) {
        if (changes[i].path.length === 0) continue
        treeEntries.push({ segments: changes[i].path.split('/'), data: changes[i] })
      }
      const tree = buildTree(treeEntries)
      annotateStaged(tree)
      const flat = flattenTree(tree, 0, '@changes', props.collapsed, [], '@changes')

      const rows = []
      for (let i = 0; i < flat.length; i += 1) {
        const node = flat[i]
        const indent = (node.depth * 12) + 'px'
        if (node.kind === 'dir') {
          const child = node.data
          const total = child.total === undefined ? 0 : child.total
          const stagedCount = child.staged === undefined ? 0 : child.staged
          const allStaged = total > 0 && stagedCount === total
          const someStaged = stagedCount > 0 && stagedCount < total
          rows.push(h('div', {
            className: 'gitops-trow' + (props.selectedKey === node.id ? ' gitops-trow-sel' : ''),
            key: node.id,
            style: { paddingLeft: indent },
            title: node.name + '（双击展开/折叠）',
            onClick: function () { props.onSelect(node.id) },
            onDoubleClick: function () { props.onToggle(node.path) },
          },
            h('span', {
              className: 'gitops-cbox' + (allStaged ? ' gitops-cbox-on' : (someStaged ? ' gitops-cbox-part' : '')),
              title: allStaged ? '取消暂存该目录' : '暂存该目录',
              onClick: function (event) {
                event.stopPropagation()
                props.onSetStaged(collectLeaves(child, []), !allStaged)
              },
            }, allStaged ? '☑' : (someStaged ? '▣' : '☐')),
            twisty({ collapsed: node.collapsed, onToggle: function () { props.onToggle(node.path) } }),
            h('span', { className: 'gitops-tname' }, node.name),
            h('span', { className: 'gitops-tdim' }, String(total) + ' 个文件')))
        } else {
          const file = node.data || {}
          rows.push(h('div', {
            className: 'gitops-trow' + (props.selectedKey === node.id ? ' gitops-trow-sel' : ''),
            key: node.id,
            style: { paddingLeft: indent },
            title: text(file.path),
            onClick: function () { props.onSelect(node.id) },
          },
            h('span', {
              className: 'gitops-cbox' + (file.staged === true ? ' gitops-cbox-on' : ''),
              title: file.staged === true ? '取消暂存' : '暂存',
              onClick: function (event) {
                event.stopPropagation()
                props.onSetStaged([file], file.staged !== true)
              },
            }, file.staged === true ? '☑' : '☐'),
            h('span', { className: 'gitops-tw' }),
            h('span', { className: 'gitops-st' + statusClass(file.displayCode) }, statusLabel(file.displayCode)),
            h('span', { className: 'gitops-tname' }, node.name)))
        }
      }

      const stagedCount = props.stagedCount
      const totalChanges = changes.length
      const canCommit = props.busy !== true && props.message.trim().length > 0 && totalChanges > 0
      const label = stagedCount > 0
        ? ('提交 ' + String(stagedCount) + ' 个文件')
        : ('全部暂存并提交（' + String(totalChanges) + '）')

      const side = h('div', { className: 'gitops-commitpane' },
        h('div', { className: 'gitops-group-title' }, '提交信息'),
        clearable('msg', h('textarea', {
          className: 'gitops-input',
          rows: 6,
          placeholder: '提交信息（必填）',
          value: props.message,
          onChange: function (event) { props.onMessage(event.target.value) },
        }), props.message.length > 0, function () { props.onMessage('') }, 'gitops-clearable-area'),
        h('div', { className: 'gitops-dim' }, '已暂存 ' + String(stagedCount) + ' / 共 ' + String(totalChanges) + ' 个文件'),
        h('button', {
          type: 'button',
          className: 'gitops-btn gitops-primary',
          disabled: !canCommit,
          onClick: props.onCommit,
        }, props.busy === true ? '处理中…' : label),
        totalChanges > 0 ? h('button', {
          type: 'button', className: 'gitops-btn',
          disabled: props.busy === true,
          onClick: props.onSetStagedAll,
        }, stagedCount > 0 ? '取消全部暂存' : '全部暂存') : null)

      return h('div', { className: 'gitops-changes' },
        h('div', { className: 'gitops-changes-tree' }, rows.length > 0 ? rows : h('div', { className: 'gitops-pane gitops-ok' }, '工作区干净')),
        side)
    }

