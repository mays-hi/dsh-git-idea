    /* ── 工作树那颗图标 ──

       git 官方**没有**工作树图标：git 项目只发行过自己的 logo，而 \`git gui\` /
       \`gitk\` 都早于 \`git worktree\`。所以这里对的是事实标准 —— VS Code 的
       codicons 里有一个 \`worktree\`（还带 small / compact 两个尺寸变体），VS Code
       自己也用它表示工作树。

       它是**实心**路径，所以不能塞进 60-icons.js 那张表：那张表整张都是描边的，
       \`fill:none\` 会把实心字形整块吃掉。形状取自 @vscode/codicons 的
       \`worktree.svg\`（Microsoft，CC BY 4.0；见 README 的「许可」）。 */
    const WORKTREE_ICON_PATH = 'M12.854 14.8542L14.854 12.8542C15.049 12.6592 15.049 12.3422 14.854 12.1472L12.854 10.1472C12.659 9.95223 12.342 9.95223 12.147 10.1472C11.952 10.3422 11.952 10.6592 12.147 10.8542L13.293 12.0002H8.5C8.225 12.0002 8 11.7752 8 11.5002V5.50023C8 5.22523 8.225 5.00023 8.5 5.00023H13.293L12.147 6.14623C12.049 6.24423 12.001 6.37223 12.001 6.50023C12.001 6.62823 12.05 6.75623 12.147 6.85423C12.342 7.04923 12.659 7.04923 12.854 6.85423L14.854 4.85423C15.049 4.65923 15.049 4.34223 14.854 4.14723L12.854 2.14723C12.659 1.95223 12.342 1.95223 12.147 2.14723C11.952 2.34223 11.952 2.65923 12.147 2.85423L13.293 4.00023H8.5C7.673 4.00023 7 4.67323 7 5.50023V8.00023H1.5C1.224 8.00023 1 8.22423 1 8.50023C1 8.77623 1.224 9.00023 1.5 9.00023H7V11.5002C7 12.3272 7.673 13.0002 8.5 13.0002H13.293L12.147 14.1462C12.049 14.2442 12.001 14.3722 12.001 14.5002C12.001 14.6282 12.05 14.7562 12.147 14.8542C12.342 15.0492 12.659 15.0492 12.854 14.8542Z'

    function WorktreeIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16',
        fill: 'currentColor', stroke: 'none',
        style: { flex: 'none', display: 'block' },
      }, h('path', { d: WORKTREE_ICON_PATH }))
    }

    /* ── 忙的时候那一颗 ──

       一个缺口的圆环，自己在转。它**替掉**前面那颗图标（分支或工作树），忙完再换
       回来：让分支图标自己转，读起来像"这个分支在转"，而屏幕上要说的是"还在忙"。
       方向感也丢不了 —— 它一停，出现的就是该出现的那一颗（在工作树里就是工作树
       字形）。

       形状是 270° 的一段弧（3/4 圆），留出的缺口让"在转"看得出来；描边和另两颗
       图标同一套（1.6，currentColor）。旋转是 CSS 里 dsh-git-spin 那条规则
       （46-css.js），只转不改尺寸，所以没有任何布局位移。 */
    function SpinnerIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
        style: { flex: 'none', display: 'block' },
        className: 'dsh-git-spin',
      }, h('path', { d: 'M8 2.2 A5.8 5.8 0 1 1 2.2 8' }))
    }

    function BranchIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      const shapes = [
        h('circle', { key: 'a', cx: 4, cy: 3.5, r: 1.7, fill: 'currentColor', stroke: 'none' }),
        h('circle', { key: 'b', cx: 4, cy: 12.5, r: 1.7, fill: 'currentColor', stroke: 'none' }),
        h('circle', { key: 'c', cx: 12, cy: 6, r: 1.7, fill: 'currentColor', stroke: 'none' }),
        h('path', { key: 'd', d: 'M4 5.4 L4 10.6' }),
        h('path', { key: 'e', d: 'M4 8 C 7.5 8, 8.5 6, 10.2 6' }),
      ]
      /* The "no repository here" mark is drawn inside the same viewBox rather
         than rendered as a second element beside the icon. Two flex siblings
         read as two buttons; one glyph reads as one button whose meaning is
         "Git, not enabled yet". The bottom-right corner is empty in the branch
         drawing, so the strokes never collide. */
      if (props.plus === true) {
        shapes.push(h('path', { key: 'ph', d: 'M10.9 12.3 L14.3 12.3', strokeWidth: 1.9 }))
        shapes.push(h('path', { key: 'pv', d: 'M12.6 10.6 L12.6 14', strokeWidth: 1.9 }))
      }
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
        strokeLinecap: 'round', style: { flex: 'none', display: 'block' },
      }, shapes)
    }

    function buildTree(entries) {
      const root = { children: {}, leaves: [] }
      for (let i = 0; i < entries.length; i += 1) {
        const segments = entries[i].segments
        if (segments.length === 0) continue
        /* ── a directory git collapsed ──
           An untracked directory arrives as one entry ending in "/" — that is
           git saying "a directory, contents not listed". The last segment is
           then empty, and the one before it names the row; the container has to
           stop one level higher, or the row would be its own parent. Without
           this the entry was dropped on the floor: the tree quietly showed 10 of
           the 12 changes, the numbers under a folder did not add up to the count
           on the tab, and those files could not be staged from here at all. */
        const collapsed = segments[segments.length - 1].length === 0
        const stops = collapsed ? segments.length - 2 : segments.length - 1
        let node = root
        for (let k = 0; k < stops; k += 1) {
          const key = segments[k]
          if (key.length === 0) continue
          if (node.children[key] === undefined) node.children[key] = { children: {}, leaves: [] }
          node = node.children[key]
        }
        const name = collapsed ? (segments[stops] + '/') : segments[segments.length - 1]
        if (name.length === 0 || name === '/') continue
        node.leaves.push({ name: name, data: entries[i].data, dir: collapsed })
      }
      return root
    }

    function countLeaves(node) {
      let total = node.leaves.length
      const keys = Object.keys(node.children)
      for (let i = 0; i < keys.length; i += 1) total += countLeaves(node.children[keys[i]])
      return total
    }

    function annotateStaged(node) {
      let total = 0
      let staged = 0
      for (let i = 0; i < node.leaves.length; i += 1) {
        total += 1
        if (node.leaves[i].data != null && node.leaves[i].data.staged === true) staged += 1
      }
      const keys = Object.keys(node.children)
      for (let i = 0; i < keys.length; i += 1) {
        const child = node.children[keys[i]]
        const sub = annotateStaged(child)
        child.total = sub.total
        child.staged = sub.staged
        total += sub.total
        staged += sub.staged
      }
      return { total: total, staged: staged }
    }

    function collectLeaves(node, out) {
      for (let i = 0; i < node.leaves.length; i += 1) if (node.leaves[i].data != null) out.push(node.leaves[i].data)
      const keys = Object.keys(node.children)
      for (let i = 0; i < keys.length; i += 1) collectLeaves(node.children[keys[i]], out)
      return out
    }

    function squeeze(node) {
      let name = ''
      let target = node
      while (target.leaves.length === 0) {
        const inner = Object.keys(target.children)
        if (inner.length !== 1) break
        name = name.length === 0 ? inner[0] : (name + '/' + inner[0])
        target = target.children[inner[0]]
      }
      return { name: name, target: target }
    }

    function flattenTree(node, depth, prefix, collapsed, out, id) {
      const keys = Object.keys(node.children).sort()
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i]
        const squeezed = squeeze(node.children[key])
        const total = countLeaves(squeezed.target)
        if (total === 0) continue
        const name = squeezed.name.length === 0 ? key : (key + '/' + squeezed.name)
        const path = prefix + '/' + name
        const isCollapsed = collapsed[path] === true
        out.push({
          kind: 'dir', name: name, path: path, depth: depth, collapsed: isCollapsed,
          count: total, data: squeezed.target, id: id + ':d:' + path,
        })
        if (!isCollapsed) flattenTree(squeezed.target, depth + 1, path, collapsed, out, id)
      }
      for (let i = 0; i < node.leaves.length; i += 1) {
        const leaf = node.leaves[i]
        out.push({ kind: 'leaf', name: leaf.name, depth: depth, data: leaf.data, dir: leaf.dir === true, id: id + ':f:' + prefix + '/' + leaf.name })
      }
      return out
    }

