    function twisty(props) {
      return h('span', {
        className: 'dsh-git-tw',
        title: props.collapsed === true ? '展开' : '折叠',
        onClick: function (event) {
          event.stopPropagation()
          props.onToggle()
        },
      }, props.collapsed === true ? '▶' : '▼')
    }

    /* The directory row, drawn the same way by every tree in the plugin: the log
       sidebar, a commit's file list, the changes tree, the untracked directory's
       own listing. One element, one set of classes, one gesture — a click selects
       the row, a double click folds it, and the twisty is the second way to fold
       the same thing.

       Only the dim text at the right edge differs, and what it counts depends on
       what the tree is a tree of ("12" branches, "3 个文件"), so that is the one
       argument. */
    function treeDirRow(node, props, dim) {
      return h('div', {
        className: 'dsh-git-trow' + (props.selectedKey === node.id ? ' dsh-git-trow-sel' : ''),
        key: node.id,
        style: { paddingLeft: (6 + node.depth * 12) + 'px' },
        title: node.name + '（双击展开/折叠）',
        onClick: function () { props.onSelect(node.id) },
        onDoubleClick: function () { props.onToggle(node.path) },
      },
        twisty({ collapsed: node.collapsed, onToggle: function () { props.onToggle(node.path) } }),
        h('span', { className: 'dsh-git-tname' }, node.name),
        h('span', { className: 'dsh-git-tdim' }, dim))
    }
