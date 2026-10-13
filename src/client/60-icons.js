    /* One component with a path table instead of a dozen components: every glyph
       in the table is a 16-box outline drawn in currentColor. Three shapes do not
       fit that mould and get a component of their own below: the filled worktree
       mark, the spinner, and the branch mark whose "not a repository yet" plus is
       drawn inside the same viewBox. */
    const ICON_PATHS = {
      search: ['M7 2.6 A4.4 4.4 0 1 0 7 11.4 A4.4 4.4 0 1 0 7 2.6', 'M10.3 10.3 L13.6 13.6'],
      /* Two glyphs, one per mode, so the button says which order is in force
         rather than only that it can be changed. */
      sortName: ['M2.4 12.2 L5.2 4.2 L8 12.2', 'M3.4 9.6 H7', 'M11.2 3.8 V12.2', 'M9.3 10.3 L11.2 12.2 L13.1 10.3'],
      sortRecent: ['M8 2.8 A5.2 5.2 0 1 0 8 13.2 A5.2 5.2 0 1 0 8 2.8', 'M8 5.4 V8.4 L10.3 9.7'],
      right: ['M6.4 3.8 L10.6 8 L6.4 12.2'],
      back: ['M9.6 3.8 L5.4 8 L9.6 12.2'],
      down: ['M3.8 6.4 L8 10.6 L12.2 6.4'],
      plus: ['M8 3.4 V12.6', 'M3.4 8 H12.6'],
      pull: ['M8 3.2 V9.8', 'M5.2 7 L8 9.8 L10.8 7', 'M3.6 11.8 V12.6 H12.4 V11.8'],
      /* cherry-pick copies a commit onto the current branch, so it borrows the
         copy glyph rather than an arrow: fetch and pull already own the arrows. */
      /* A cherry, the way IDEA draws cherry-pick: two fruit and a stem. The copy
         glyph read as "duplicate", which this is not — it lands a commit on the
         branch you are on. */
      pick: ['M4.1 9.6 A2.1 2.1 0 1 0 4.1 13.8 A2.1 2.1 0 1 0 4.1 9.6',
        'M8.9 9 A2.1 2.1 0 1 0 8.9 13.2 A2.1 2.1 0 1 0 8.9 9',
        'M4.2 9.6 C 4.5 6.6, 6 4.8, 9.4 4.2',
        'M9.4 4.2 C 11.6 4.5, 12.4 6, 11.2 7'],
      revert: ['M6.4 3.8 L3.2 7 L6.4 10.2', 'M3.2 7 H9.6 A3.4 3.4 0 0 1 9.6 13.8 H7.8'],
      tag: ['M3 3.4 H7.4 L13 9 L9 13 L3.4 7.4 Z', 'M5.6 5 A0.9 0.9 0 1 0 5.6 6.8 A0.9 0.9 0 1 0 5.6 5'],
      /* An untracked directory git collapsed into one entry: the row has to say
         "directory" on its own, because there is no listing behind it until it is
         opened. */
      folder: ['M2.2 4.4 H6.4 L7.8 6.2 H13.8 V12.4 H2.2 Z'],
      undo: ['M5.9 3.6 L2.7 6.8 L5.9 10', 'M2.7 6.8 H9.3 A3.5 3.5 0 0 1 9.3 13.8 H7.3'],
    }
    /* One field, one clear button: the × sits inside the box, where the eye
       already is, so no row of buttons has to exist for it. */
    function clearable(key, input, hasValue, onClear, variant) {
      const classes = ['dsh-git-clearable']
      if (variant != null && variant.length > 0) classes.push(variant)
      return h('div', { key: key, className: classes.join(' ') },
        input,
        hasValue === true ? h('button', {
          key: 'x', type: 'button', className: 'dsh-git-clear-x', 'aria-label': '清空',
          onClick: function (event) {
            stopEvent(event)
            if (event != null && typeof event.preventDefault === 'function') event.preventDefault()
            onClear()
          },
        }, '×') : null)
    }

    function Icon(props) {
      const paths = ICON_PATHS[props.name]
      if (paths === undefined) return null
      const size = typeof props.size === 'number' ? props.size : 14
      const shapes = []
      for (let i = 0; i < paths.length; i += 1) shapes.push(h('path', { key: 'p' + i, d: paths[i] }))
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        style: { flex: 'none', display: 'block' },
      }, shapes)
    }

    /* ── 工作树那颗图标 ──

       git 官方**没有**工作树图标：git 项目只发行过自己的 logo，而 \`git gui\` /
       \`gitk\` 都早于 \`git worktree\`。所以这里对的是事实标准 —— VS Code 的
       codicons 里有一个 \`worktree\`（还带 small / compact 两个尺寸变体），VS Code
       自己也用它表示工作树。

       它是**实心**路径，所以不能塞进上面那张表：那张表整张都是描边的，
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
