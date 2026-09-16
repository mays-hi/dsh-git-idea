    function ChangesPane(props) {
      const work = props.work
      if (work == null) return h('div', { className: 'dsh-git-pane dsh-git-dim' }, '正在读取工作区…')
      if (work.ok !== true) {
        const reason = work.error === 'not-a-repository'
          ? ('不是 git 仓库：' + text(work.repo))
          : '无法读取工作区状态'
        return h('div', { className: 'dsh-git-pane dsh-git-error' }, reason)
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

      /* ── the indent is not the row's padding ──
         A row's own padding-left moved the checkbox along with the tree, so the
         boxes marched to the right one step per level and never lined up in a
         column: measured on a screenshot of this panel at depth 5 the box sat
         60px in, and nothing could be scanned or ticked down a single edge. IDEA's
         commit window keeps the boxes in a fixed left gutter and indents what is
         left of the row, so that is what this is: the checkbox first, then a
         spacer as wide as the depth, then the twisty/status and the name. */
      const INDENT_W = 12
      const indentPad = function (depth) {
        return h('span', { key: 'pad', className: 'dsh-git-tind', style: { width: (depth * INDENT_W) + 'px' } })
      }
      const stageBox = function (key, state, title, onClick) {
        return h('span', {
          key: key,
          className: 'dsh-git-cbox' + (state === 'all' ? ' dsh-git-cbox-on' : (state === 'some' ? ' dsh-git-cbox-part' : '')),
          title: title,
          onClick: function (event) {
            event.stopPropagation()
            onClick()
          },
        }, state === 'all' ? '☑' : (state === 'some' ? '▣' : '☐'))
      }

      const rows = []
      for (let i = 0; i < flat.length; i += 1) {
        const node = flat[i]
        if (node.kind === 'dir') {
          const child = node.data
          const total = child.total === undefined ? 0 : child.total
          const stagedCount = child.staged === undefined ? 0 : child.staged
          const allStaged = total > 0 && stagedCount === total
          const someStaged = stagedCount > 0 && stagedCount < total
          rows.push(h('div', {
            className: 'dsh-git-trow' + (props.selectedKey === node.id ? ' dsh-git-trow-sel' : ''),
            key: node.id,
            title: node.name + '（双击展开/折叠）',
            onClick: function () { props.onSelect(node.id) },
            onDoubleClick: function () { props.onToggle(node.path) },
          },
            stageBox('box', allStaged ? 'all' : (someStaged ? 'some' : 'none'),
              allStaged ? '取消暂存该目录' : '暂存该目录',
              function () { props.onSetStaged(collectLeaves(child, []), !allStaged) }),
            indentPad(node.depth),
            twisty({ collapsed: node.collapsed, onToggle: function () { props.onToggle(node.path) } }),
            h('span', { className: 'dsh-git-tname' }, node.name),
            h('span', { className: 'dsh-git-tdim' }, String(total) + ' 个文件')))
        } else if (node.dir === true) {
          /* A directory git collapsed: one entry, no contents. Ticking it stages
             the whole thing (`git add -- dir` needs no listing); opening it is the
             one read that lists the files, and it happens here, on the click. */
          const file = node.data || {}
          const open = props.untrackedOpen[file.path] === true
          rows.push(h('div', {
            className: 'dsh-git-trow' + (props.selectedKey === node.id ? ' dsh-git-trow-sel' : ''),
            key: node.id,
            title: text(file.path) + '（未跟踪的目录，双击展开）',
            onClick: function () { props.onSelect(node.id) },
            onDoubleClick: function () { props.onToggleUntracked(file.path) },
          },
            stageBox('box', file.staged === true ? 'all' : 'none',
              file.staged === true ? '取消暂存' : '暂存整个目录',
              function () { props.onSetStaged([file], file.staged !== true) }),
            indentPad(node.depth),
            twisty({ collapsed: !open, onToggle: function () { props.onToggleUntracked(file.path) } }),
            h('span', { key: 'ico', className: 'dsh-git-tdir' }, h(Icon, { name: 'folder', size: 12 })),
            h('span', { className: 'dsh-git-tname' }, node.name)))
          if (open) {
            const list = props.untrackedFiles[file.path]
            if (list === undefined) {
              rows.push(h('div', { key: node.id + ':wait', className: 'dsh-git-trow dsh-git-dim' },
                indentPad(node.depth + 1), h('span', { className: 'dsh-git-tname' }, '正在读取…')))
            } else if (list.length === 0) {
              rows.push(h('div', { key: node.id + ':none', className: 'dsh-git-trow dsh-git-dim' },
                indentPad(node.depth + 1), h('span', { className: 'dsh-git-tname' }, '（没有文件，可能都被 .gitignore 排除了）')))
            }
            for (let k = 0; k < list.length; k += 1) {
              const inside = list[k]
              const prefix = text(file.path).replace(/\/+$/, '') + '/'
              const label = inside.indexOf(prefix) === 0 ? inside.slice(prefix.length) : inside
              rows.push(h('div', {
                className: 'dsh-git-trow',
                key: node.id + ':f:' + inside,
                title: inside + '（点开看差异）',
                onClick: function () { props.onOpenDiff({ path: inside, workCode: '??', untracked: true, staged: false, displayCode: '?' }) },
              },
                stageBox('box', 'none', '暂存', function () { props.onSetStaged([{ path: inside, untracked: true }], true) }),
                indentPad(node.depth + 1),
                h('span', { className: 'dsh-git-tw' }),
                h('span', { className: 'dsh-git-st dsh-git-st-U' }, '?'),
                h('span', { className: 'dsh-git-tname' }, label)))
            }
          }
        } else {
          const file = node.data || {}
          rows.push(h('div', {
            className: 'dsh-git-trow' + (props.selectedKey === node.id ? ' dsh-git-trow-sel' : ''),
            key: node.id,
            title: text(file.path) + '（点开看差异）',
            onClick: function () {
              props.onSelect(node.id)
              if (typeof props.onOpenDiff === 'function') props.onOpenDiff(file)
            },
          },
            stageBox('box', file.staged === true ? 'all' : 'none',
              file.staged === true ? '取消暂存' : '暂存',
              function () { props.onSetStaged([file], file.staged !== true) }),
            indentPad(node.depth),
            h('span', { className: 'dsh-git-tw' }),
            h('span', { className: 'dsh-git-st' + statusClass(file.displayCode) }, statusLabel(file.displayCode)),
            h('span', { className: 'dsh-git-tname' }, node.name)))
        }
      }

      const stagedCount = props.stagedCount
      const totalChanges = changes.length
      const canCommit = props.busy !== true && props.message.trim().length > 0 && totalChanges > 0
      const label = stagedCount > 0
        ? ('提交 ' + String(stagedCount) + ' 个文件')
        : ('全部暂存并提交（' + String(totalChanges) + '）')

      const side = h('div', { className: 'dsh-git-commitpane' },
        h('div', { className: 'dsh-git-group-title' }, '提交信息'),
        clearable('msg', h('textarea', {
          className: 'dsh-git-input',
          rows: 6,
          placeholder: '提交信息（必填）',
          value: props.message,
          onChange: function (event) { props.onMessage(event.target.value) },
        }), props.message.length > 0, function () { props.onMessage('') }, 'dsh-git-clearable-area'),
        h('div', { className: 'dsh-git-dim' }, '已暂存 ' + String(stagedCount) + ' / 共 ' + String(totalChanges) + ' 个文件'),
        h('button', {
          type: 'button',
          className: 'dsh-git-btn dsh-git-primary',
          disabled: !canCommit,
          onClick: props.onCommit,
        }, props.busy === true ? '处理中…' : label),
        totalChanges > 0 ? h('button', {
          type: 'button', className: 'dsh-git-btn',
          disabled: props.busy === true,
          onClick: props.onSetStagedAll,
        }, stagedCount > 0 ? '取消全部暂存' : '全部暂存') : null)

      return h('div', { className: 'dsh-git-changes' },
        h('div', { className: 'dsh-git-changes-tree' }, rows.length > 0 ? rows : h('div', { className: 'dsh-git-pane dsh-git-ok' }, '工作区干净')),
        side)
    }
