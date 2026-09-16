    /* ── two groups ──

       IDEA's commit window does not show one list of everything git noticed. It
       shows a changelist — the tracked changes — and under it "Unversioned
       Files": the paths git has never seen. Two nodes, two counts, and every
       unversioned entry stays a file rather than a folder mixed in among the
       tracked ones.

       This pane merged all of it into one tree: an untracked directory sat
       among the tracked ones with nothing saying it was untracked, and the only
       way to tell was to read each row's status letter. The split is the test
       the rest of the panel already uses — `untracked` and not staged means git
       does not track the path — and it lines up with staging: tick an
       unversioned file's box and it moves up into the changelist, which is what
       IDEA's "add to the changelist" does.

       ── two views ──

       IDEA's other toggle, next to the changes: a tree of directories, or a flat
       list of paths. Same rows, same boxes, same gestures — only the label and
       the indent differ. The flat list is sorted by path, because git's own
       order (index first, then worktree, then untracked) is the order git
       happened to answer in, not an order anyone chose. */

    function isUnversioned(entry) {
      return entry.untracked === true && entry.staged !== true
    }

    function ChangesPane(props) {
      /* Read before the early returns: a hook cannot be skipped by a branch. */
      const settings = useGitSettings()
      const view = settings.changesView === 'flat' ? 'flat' : 'tree'
      const work = props.work
      if (work == null) return h('div', { className: 'dsh-git-pane dsh-git-dim' }, '正在读取工作区…')
      if (work.ok !== true) {
        const reason = work.error === 'not-a-repository'
          ? ('不是 git 仓库：' + text(work.repo))
          : '无法读取工作区状态'
        return h('div', { className: 'dsh-git-pane dsh-git-error' }, reason)
      }

      const changes = mergeChanges(work)
      const tracked = []
      const unversioned = []
      for (let i = 0; i < changes.length; i += 1) {
        const entry = changes[i]
        if (entry.path.length === 0) continue
        if (isUnversioned(entry)) unversioned.push(entry)
        else tracked.push(entry)
      }

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

      /* The flat label is the whole path, so the folder has to be told apart
         from the file without a column of its own: it is dimmed, and the name
         that matters stays at full contrast. */
      const splitPath = function (path) {
        const dir = path.slice(-1) === '/' ? path.slice(0, -1) : path
        const cut = dir.lastIndexOf('/')
        return {
          dir: cut < 0 ? '' : dir.slice(0, cut + 1),
          base: (cut < 0 ? dir : dir.slice(cut + 1)) + (path.slice(-1) === '/' ? '/' : ''),
        }
      }
      const nameCell = function (label, flat) {
        const parts = splitPath(label)
        if (flat !== true || parts.dir.length === 0) return h('span', { className: 'dsh-git-tname' }, parts.base)
        return h('span', { className: 'dsh-git-tname' },
          h('span', { key: 'd', className: 'dsh-git-tdim' }, parts.dir),
          h('span', { key: 'b' }, parts.base))
      }
      const rowClass = function (key, extra) {
        return 'dsh-git-trow' + (extra === undefined ? '' : ' ' + extra)
          + (props.selectedKey === key ? ' dsh-git-trow-sel' : '')
      }

      /* One tracked change: box, status letter, name. In either view the click
         opens the patch (IDEA's commit window previews the selection too); the
         tree adds the indent the flat list does not have. */
      const fileRow = function (entry, key, depth, flat, label) {
        return h('div', {
          className: rowClass(key),
          key: key,
          title: text(entry.path) + '（点开看差异）',
          onClick: function () {
            props.onSelect(key)
            if (typeof props.onOpenDiff === 'function') props.onOpenDiff(entry)
          },
        },
          stageBox('box', entry.staged === true ? 'all' : 'none',
            entry.staged === true ? '取消暂存' : '暂存',
            function () { props.onSetStaged([entry], entry.staged !== true) }),
          indentPad(depth),
          h('span', { className: 'dsh-git-tw' }),
          h('span', { className: 'dsh-git-st' + statusClass(entry.displayCode) }, statusLabel(entry.displayCode)),
          nameCell(label, flat))
      }

      /* A directory git collapsed: one entry, no contents. Ticking it stages
         the whole thing (`git add -- dir` needs no listing); opening it is the
         one read that lists the files, and it happens on the click. The listing
         is a state of its own: undefined while the read is in flight — which is
         not a case the loop below may fall through to. */
      const untrackedDirRows = function (entry, key, depth, flat, label) {
        const path = text(entry.path)
        const open = props.untrackedOpen[path] === true
        const rows = [h('div', {
          className: rowClass(key),
          key: key,
          title: path + '（未跟踪的目录，双击展开）',
          onClick: function () { props.onSelect(key) },
          onDoubleClick: function () { props.onToggleUntracked(path) },
        },
          stageBox('box', entry.staged === true ? 'all' : 'none',
            entry.staged === true ? '取消暂存' : '暂存整个目录',
            function () { props.onSetStaged([entry], entry.staged !== true) }),
          indentPad(depth),
          twisty({ collapsed: !open, onToggle: function () { props.onToggleUntracked(path) } }),
          h('span', { key: 'ico', className: 'dsh-git-tdir' }, h(Icon, { name: 'folder', size: 12 })),
          nameCell(label, flat))]
        if (open) {
          const list = props.untrackedFiles[path]
          if (list === undefined) {
            rows.push(h('div', { key: key + ':wait', className: 'dsh-git-trow dsh-git-dim' },
              indentPad(depth + 1), h('span', { className: 'dsh-git-tname' }, '正在读取…')))
          } else if (list.length === 0) {
            rows.push(h('div', { key: key + ':none', className: 'dsh-git-trow dsh-git-dim' },
              indentPad(depth + 1), h('span', { className: 'dsh-git-tname' }, '（没有文件，可能都被 .gitignore 排除了）')))
          } else {
            const prefix = path.replace(/\/+$/, '') + '/'
            for (let k = 0; k < list.length; k += 1) {
              const inside = list[k]
              const relative = inside.indexOf(prefix) === 0 ? inside.slice(prefix.length) : inside
              const childKey = key + ':f:' + inside
              rows.push(h('div', {
                className: rowClass(childKey),
                key: childKey,
                title: inside + '（点开看差异）',
                onClick: function () {
                  props.onSelect(childKey)
                  props.onOpenDiff({ path: inside, workCode: '??', untracked: true, staged: false, displayCode: '?' })
                },
              },
                stageBox('box', 'none', '暂存', function () { props.onSetStaged([{ path: inside, untracked: true }], true) }),
                indentPad(depth + 1),
                h('span', { className: 'dsh-git-tw' }),
                h('span', { className: 'dsh-git-st dsh-git-st-U' }, '?'),
                /* The listing is flat, not a tree — a file two levels in is shown
                   as `deep/b.txt` however deep it really is — so the folder is
                   always the dimmed part, in both views. */
                nameCell(flat === true ? inside : relative, true)))
            }
          }
        }
        return rows
      }

      const treeRows = function (entries, groupKey) {
        const treeEntries = []
        for (let i = 0; i < entries.length; i += 1) treeEntries.push({ segments: entries[i].path.split('/'), data: entries[i] })
        const tree = buildTree(treeEntries)
        annotateStaged(tree)
        const flat = flattenTree(tree, 0, groupKey, props.collapsed, [], groupKey)
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
              className: rowClass(node.id),
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
            rows.push.apply(rows, untrackedDirRows(node.data || {}, node.id, node.depth, false, node.name))
          } else {
            rows.push(fileRow(node.data || {}, node.id, node.depth, false, node.name))
          }
        }
        return rows
      }

      const flatRows = function (entries, groupKey) {
        const sorted = entries.slice()
        sorted.sort(function (a, b) { return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0) })
        const rows = []
        for (let i = 0; i < sorted.length; i += 1) {
          const entry = sorted[i]
          const key = groupKey + ':f:' + entry.path
          /* git only ever collapses a *directory* into a trailing slash, so that
             one character is the whole test for "this row can be opened". */
          if (entry.path.slice(-1) === '/') rows.push.apply(rows, untrackedDirRows(entry, key, 0, true, entry.path))
          else rows.push(fileRow(entry, key, 0, true, entry.path))
        }
        return rows
      }

      /* A group title is a row of the tree, so it obeys the tree's gesture:
         one click selects, the double click or the twisty folds. It has no box
         of its own — IDEA's changelist node has none either; whole-group work is
         what the two buttons in the commit pane are for. */
      const groupTitle = function (label, key, count, hint) {
        return h('div', {
          className: rowClass(key + ':title', 'dsh-git-cgroup'),
          key: key + ':title',
          title: label + '（' + hint + '；双击展开/折叠）',
          onClick: function () { props.onSelect(key + ':title') },
          onDoubleClick: function () { props.onToggle(key) },
        },
          twisty({ collapsed: props.collapsed[key] === true, onToggle: function () { props.onToggle(key) } }),
          h('span', { className: 'dsh-git-tname' }, label),
          h('span', { className: 'dsh-git-tdim' }, String(count) + ' 个文件'))
      }

      const rows = []
      const groups = [
        { key: '@tracked', label: '默认变更列表', hint: 'git 管着的改动，框勾上就是进了索引', entries: tracked },
        { key: '@untracked', label: '未跟踪的文件', hint: 'git 还没见过的文件', entries: unversioned },
      ]
      for (let g = 0; g < groups.length; g += 1) {
        const group = groups[g]
        if (group.entries.length === 0) continue
        rows.push(groupTitle(group.label, group.key, group.entries.length, group.hint))
        if (props.collapsed[group.key] === true) continue
        rows.push.apply(rows, view === 'flat' ? flatRows(group.entries, group.key) : treeRows(group.entries, group.key))
      }

      const stagedCount = props.stagedCount
      const totalChanges = changes.length
      const canCommit = props.busy !== true && props.message.trim().length > 0 && totalChanges > 0
      const label = stagedCount > 0
        ? ('提交 ' + String(stagedCount) + ' 个文件')
        : ('全部暂存并提交（' + String(totalChanges) + '）')

      const viewButton = function (id, name, hint) {
        return h('button', {
          key: id,
          type: 'button',
          className: 'dsh-git-cview' + (view === id ? ' dsh-git-cview-on' : ''),
          title: hint,
          onClick: function () { saveSettings(Object.assign({}, settings, { changesView: id })) },
        }, name)
      }

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
        h('div', { className: 'dsh-git-changes-tree' },
          h('div', { key: 'bar', className: 'dsh-git-cbar' },
            h('span', { key: 'v', className: 'dsh-git-cviews' },
              viewButton('tree', '树', '文件树视图：按目录折叠'),
              viewButton('flat', '扁平', '扁平文件视图：每个文件一行，按路径排序')),
            h('span', { key: 'c', className: 'dsh-git-tdim' }, '已暂存 ' + String(stagedCount) + ' / ' + String(totalChanges))),
          h('div', { key: 'list', className: 'dsh-git-clist' }, rows.length > 0 ? rows : h('div', { className: 'dsh-git-pane dsh-git-ok' }, '工作区干净'))),
        side)
    }
