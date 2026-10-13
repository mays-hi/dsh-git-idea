    /* ── 文件树 ──

       git 只给一串路径，这里把它们折成树：分支树、变更树、提交详情里的文件树，三个
       调用方共用这一份实现。目录行要能整组进 / 出索引，所以 `annotateStaged` 给每个
       节点记下「一共几个文件、其中几个已暂存」；折叠状态由调用方按 path 记着。

       图标不在这里 —— `BranchIcon` / `WorktreeIcon` / `SpinnerIcon` 和那张描边
       图标表一起放在 60-icons.js。 */

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

