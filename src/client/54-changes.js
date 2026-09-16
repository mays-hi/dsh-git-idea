    /* ── two groups ──

       IDEA's commit window does not show one list of everything git noticed. It
       shows a changelist — the tracked changes — and under it a node of new files:
       the paths git has never committed. Two nodes, two counts, and a new file
       stays a file rather than a folder mixed in among the tracked ones.

       This pane merged all of it into one tree: an untracked directory sat among
       the tracked ones with nothing saying it was untracked, and the only way to
       tell was to read each row's status letter.

       ── which group a new file belongs to ──

       Not `untracked` alone. Ticking a box runs `git add`, and the entry comes
       back as `A.` — a path in the index that HEAD has never seen. Grouping by
       `untracked` alone therefore made a ticked file leave this group for the
       changelist, and ticking the group's own box emptied it: the reader pressed
       one checkbox and lost sight of everything they had just ticked (reported
       from the running panel: 「全选未跟踪文件列表，会导致这个未跟踪文件列表消失
       合并到默认列表中」). A file that has been *added but not committed* is still
       a new file, so it stays here, its box just moves. Un-ticking it puts it back
       in the working tree as untracked, in the same row.

       So the test is "HEAD has never had this path", in two shapes: git has not
       seen it at all (`untracked`), or it is in the index as an addition
       (`A…` — `git status --porcelain=v2` prints `A.` for added-unchanged and
       `AM` for added-then-edited, so only the first letter is the test). A rename
       is `R…` and is not a new file; nor is anything already committed. Staging an
       unversioned *directory* still expands it into the files it holds, and those
       files stay in this group too — each with its own ticked box.

       ── two views ──

       IDEA's other toggle, next to the changes: a tree of directories, or a flat
       list of paths. Same rows, same boxes, same gestures — only the label and
       the indent differ. The flat list is sorted by path, because git's own
       order (index first, then worktree, then untracked) is the order git
       happened to answer in, not an order anyone chose.

       The switch itself is not here: it lives in the panel header (80-panel.js).
       On a row of its own above the list it cost the list a full line of height
       to say two words. */

    function isNewFile(entry) {
      if (entry.untracked === true) return true
      return entry.staged === true && text(entry.indexCode).slice(0, 1) === 'A'
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
      const fresh = []
      for (let i = 0; i < changes.length; i += 1) {
        const entry = changes[i]
        if (entry.path.length === 0) continue
        if (isNewFile(entry)) fresh.push(entry)
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

      /* ── the name first, the folder after it ──

         The flat row used to be `folder/ + name`, so the one thing the eye is
         looking for sat at the far right of a path that can be 120 characters
         long — and the row's clip took it away first. On a screenshot of this
         panel `.../risk/eval/service/impl/` filled the whole row and the file it
         belonged to read `SignalClusterEvalReportServiceIm…`: the name had been
         pushed off the edge by the path that was only there to say where it
         lives. IDEA reads `name  folder/`, and so does this now.

         The two are still one cell, not two columns: the folder is dimmed and
         smaller, the name keeps full contrast and stays where a clip cannot
         reach it. */
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
          h('span', { key: 'b' }, parts.base),
          h('span', { key: 'd', className: 'dsh-git-tpath' }, parts.dir))
      }
      /* ── what the boxes are, and how many of them there are ──

         A row is not always a file: git collapses an untracked directory into one
         entry ending in "/", and that entry is one box standing for however many
         files are underneath it. Calling it "1 个文件" is what made the numbers
         disagree with the column of boxes — the panel said "新增的文件 7 个文件"
         about four files and three directories, and "共 10 个文件" about the ten
         boxes on screen, and staging those three directories would have reported
         "已暂存 3 个文件" for a whole subtree. So the two are counted apart, and
         the staged fraction counts **项** — the things the boxes actually are. */
      const kindOf = function (entries) {
        let files = 0
        let dirs = 0
        for (let i = 0; i < entries.length; i += 1) {
          if (text(entries[i].path).slice(-1) === '/') dirs += 1
          else files += 1
        }
        return { files: files, dirs: dirs }
      }
      const countText = function (kind) {
        if (kind.dirs === 0) return String(kind.files) + ' 个文件'
        if (kind.files === 0) return String(kind.dirs) + ' 个目录'
        return String(kind.files) + ' 个文件 + ' + String(kind.dirs) + ' 个目录'
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
         one click selects, the double click or the twisty folds. Its box is the
         group's own — IDEA's changelist node carries one too — and it sits in the
         same left gutter as every file row's, because it is the same act one
         level up: tick it and the whole changelist goes into the index, untick it
         and it comes back out. The untracked group's entries are by definition
         never staged, so its box only ever reads empty. */
      const groupTitle = function (label, key, hint, entries) {
        let staged = 0
        for (let i = 0; i < entries.length; i += 1) if (entries[i].staged === true) staged += 1
        const allStaged = entries.length > 0 && staged === entries.length
        const someStaged = staged > 0 && staged < entries.length
        return h('div', {
          className: rowClass(key + ':title', 'dsh-git-cgroup'),
          key: key + ':title',
          title: label + '（' + hint + '；双击展开/折叠）',
          onClick: function () { props.onSelect(key + ':title') },
          onDoubleClick: function () { props.onToggle(key) },
        },
          stageBox('box', allStaged ? 'all' : (someStaged ? 'some' : 'none'),
            allStaged ? '把这一组全部撤出索引' : '把这一组全部暂存',
            function () { props.onSetStaged(entries, !allStaged) }),
          twisty({ collapsed: props.collapsed[key] === true, onToggle: function () { props.onToggle(key) } }),
          h('span', { className: 'dsh-git-tname' }, label),
          h('span', { className: 'dsh-git-tdim' }, countText(kindOf(entries))))
      }

      const rows = []
      const groups = [
        { key: '@tracked', label: '默认变更列表', hint: 'git 管着的改动，框勾上就是进了索引', entries: tracked },
        { key: '@new', label: '新增的文件', hint: 'git 还没提交过的文件：勾上就是加入索引，但留在这一组里，直到提交', entries: fresh },
      ]
      for (let g = 0; g < groups.length; g += 1) {
        const group = groups[g]
        if (group.entries.length === 0) continue
        rows.push(groupTitle(group.label, group.key, group.hint, group.entries))
        if (props.collapsed[group.key] === true) continue
        rows.push.apply(rows, view === 'flat' ? flatRows(group.entries, group.key) : treeRows(group.entries, group.key))
      }

      const stagedEntries = []
      for (let i = 0; i < changes.length; i += 1) if (changes[i].staged === true) stagedEntries.push(changes[i])
      const stagedCount = stagedEntries.length
      const totalChanges = changes.length
      const allKind = kindOf(changes)
      const canCommit = props.busy !== true && props.message.trim().length > 0 && totalChanges > 0
      /* The count and the button say 项 because that is what the boxes are; the
         breakdown of files against directories is in the tooltip and on the group
         titles, where each number belongs to the rows under it. */
      const kindsTitle = countText(allKind)
        + (allKind.dirs > 0 ? '；目录要展开才知道里面有多少文件' : '')
      const label = stagedCount > 0
        ? ('提交 ' + countText(kindOf(stagedEntries)))
        : ('全部暂存并提交（' + String(totalChanges) + ' 项）')

      const side = h('div', { className: 'dsh-git-commitpane' },
        h('div', { className: 'dsh-git-group-title' }, '提交信息'),
        clearable('msg', h('textarea', {
          className: 'dsh-git-input',
          rows: 6,
          placeholder: '提交信息（必填）',
          value: props.message,
          onChange: function (event) { props.onMessage(event.target.value) },
        }), props.message.length > 0, function () { props.onMessage('') }, 'dsh-git-clearable-area'),
        h('div', { key: 'k', className: 'dsh-git-dim', title: kindsTitle },
          '已暂存 ' + String(stagedCount) + ' / 共 ' + String(totalChanges) + ' 项'),
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

      /* No toolbar of this pane's own any more: the view switch is in the panel
         header, and "已暂存 N / M" is on the commit pane beside it, so the list
         starts at the top of the pane and the rows get the whole height. */
      return h('div', { className: 'dsh-git-changes' },
        h('div', { className: 'dsh-git-changes-tree' },
          h('div', { key: 'list', className: 'dsh-git-clist' }, rows.length > 0 ? rows : h('div', { className: 'dsh-git-pane dsh-git-ok' }, '工作区干净'))),
        side)
    }
