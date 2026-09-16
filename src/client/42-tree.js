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
        let node = root
        for (let k = 0; k < segments.length - 1; k += 1) {
          const key = segments[k]
          if (key.length === 0) continue
          if (node.children[key] === undefined) node.children[key] = { children: {}, leaves: [] }
          node = node.children[key]
        }
        const name = segments[segments.length - 1]
        if (name.length === 0) continue
        node.leaves.push({ name: name, data: entries[i].data })
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
        out.push({ kind: 'leaf', name: leaf.name, depth: depth, data: leaf.data, id: id + ':f:' + prefix + '/' + leaf.name })
      }
      return out
    }

