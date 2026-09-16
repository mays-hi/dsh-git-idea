    function CommitDetail(props) {
      const detail = props.detail
      if (detail == null) return h('div', { className: 'gitops-detail gitops-dim' }, '选择一个提交')
      if (detail.ok !== true) return h('div', { className: 'gitops-detail gitops-error' }, '无法读取提交详情')

      const entries = []
      for (let i = 0; i < detail.files.length; i += 1) {
        const path = text(detail.files[i].path)
        if (path.length === 0) continue
        entries.push({ segments: path.split('/'), data: detail.files[i] })
      }
      const tree = buildTree(entries)
      const flat = flattenTree(tree, 0, '@files', props.collapsed, [], '@files')
      const fileRows = []
      for (let i = 0; i < flat.length; i += 1) {
        const node = flat[i]
        if (node.kind === 'dir') {
          fileRows.push(h('div', {
            className: 'gitops-trow' + (props.selectedKey === node.id ? ' gitops-trow-sel' : ''),
            key: node.id,
            style: { paddingLeft: (node.depth * 12) + 'px' },
            title: node.name + '（双击展开/折叠）',
            onClick: function () { props.onSelect(node.id) },
            onDoubleClick: function () { props.onToggle(node.path) },
          },
            twisty({ collapsed: node.collapsed, onToggle: function () { props.onToggle(node.path) } }),
            h('span', { className: 'gitops-tname' }, node.name),
            h('span', { className: 'gitops-tdim' }, String(node.count) + ' 个文件')))
        } else {
          const file = node.data || {}
          fileRows.push(h('div', {
            className: 'gitops-trow' + (props.selectedKey === node.id ? ' gitops-trow-sel' : ''),
            key: node.id,
            style: { paddingLeft: (node.depth * 12) + 'px' },
            title: text(file.path),
            onClick: function () { props.onSelect(node.id) },
          },
            h('span', { className: 'gitops-tw' }),
            h('span', { className: 'gitops-st' + statusClass(file.status) }, statusLabel(file.status)),
            h('span', { className: 'gitops-tname' }, node.name)))
        }
      }

      const inBranches = detail.branches.length > 0 ? detail.branches.join('、') : '（没有分支引用此提交）'
      const fullMessage = (detail.subject + (detail.body.length > 0 ? '\n\n' + detail.body : '')).replace(/\n+$/, '')

      return h('div', { className: 'gitops-detail' },
        h('div', { className: 'gitops-group-title' }, String(detail.files.length) + ' 个文件'),
        fileRows,
        h('div', { className: 'gitops-info' },
          h('div', { className: 'gitops-hash' }, detail.hash),
          h('div', { className: 'gitops-dim' }, detail.author + ' <' + detail.email + '>'),
          h('div', { className: 'gitops-dim' }, detail.date.replace('T', ' ').slice(0, 16)),
          h('div', { className: 'gitops-dim' }, '所在分支：' + inBranches),
          h('div', { className: 'gitops-msg' }, fullMessage)))
    }

    function mergeChanges(work) {
      const byPath = {}
      const order = []
      const put = function (path, patch) {
        if (path.length === 0) return null
        if (byPath[path] === undefined) {
          byPath[path] = { path: path, staged: false, indexCode: '', workCode: '', conflict: false }
          order.push(path)
        }
        Object.assign(byPath[path], patch)
        return byPath[path]
      }
      const list = function (value) { return Array.isArray(value) ? value : [] }
      const staged = list(work.staged)
      for (let i = 0; i < staged.length; i += 1) put(text(staged[i].path), { staged: true, indexCode: text(staged[i].code) })
      const unstaged = list(work.unstaged)
      for (let i = 0; i < unstaged.length; i += 1) put(text(unstaged[i].path), { workCode: text(unstaged[i].code) })
      const untracked = list(work.untracked)
      for (let i = 0; i < untracked.length; i += 1) {
        const entry = untracked[i]
        const path = typeof entry === 'string' ? entry : text(entry.path)
        put(path, { workCode: '??', untracked: true })
      }
      const unmerged = list(work.unmerged)
      for (let i = 0; i < unmerged.length; i += 1) put(text(unmerged[i].path), { workCode: text(unmerged[i].code), conflict: true })
      const out = []
      for (let i = 0; i < order.length; i += 1) {
        const entry = byPath[order[i]]
        entry.displayCode = entry.staged ? text(entry.indexCode) : text(entry.workCode)
        out.push(entry)
      }
      return out
    }

