
    /* ── 设置左栏里我们这一项的图标 ──

       外壳按 section id 挑左栏图标：只有 models / agent-presets / plugins 有专属
       字形，其余都退回那个齿轮 —— 我们的页面拿到的是齿轮。注册选项只有
       id / order / label（`SettingsSectionRow` 就这三个字段），没有图标这一项，
       所以能做的只有把**自己那一行**标出来，让样式表把外壳的齿轮藏掉、画上 git
       的分支标记：不动外壳的树，不新增节点，外壳的结构万一变了这里就什么也不做
       （齿轮留着），不会把左栏弄坏。

       挂在 `settings.action` 上而不是我们自己的 section 上，是因为它渲染在弹窗
       的头部、只要弹窗开着就一直在，所以不管用户在看哪一页，这一行都已经是 git
       图标；section 只在被选中时才挂载，那样图标会跟着选中状态来回变。这个注册项
       本身不画任何东西（下面那个 span 是 display:none 的，只为了拿到 document）。 */

    const NAV_ROW_CLASS = 'dsh-git-navmark'

    /* 外壳重写 className 是它每次重渲染都会做的事（选中态一变就重写），我们自己
       加的那个类会被一起抹掉；所以除了每次渲染都补一次，还盯着左栏的属性变化。 */
    function settingsNavCell(doc) {
      const nav = doc.querySelector('[role="dialog"] nav')
      if (nav == null) return null
      const cells = nav.querySelectorAll('button')
      for (let i = 0; i < cells.length; i += 1) {
        const text = cells[i].textContent
        if (typeof text === 'string' && text.trim() === SETTINGS_NAV_LABEL) return cells[i]
      }
      return null
    }

    function markSettingsNav(doc) {
      const cell = settingsNavCell(doc)
      if (cell == null) return false
      if (cell.classList.contains(NAV_ROW_CLASS) !== true) cell.classList.add(NAV_ROW_CLASS)
      return true
    }

    function SettingsNavMark() {
      let node = null
      /* 布局期就做完：等被动 effect 的话，弹窗打开的第一帧还看得见齿轮。 */
      useLayoutEffect(function () {
        let doc = null
        try {
          const from = node != null ? node : (chipNode != null ? chipNode : panelNode)
          doc = from != null ? from.ownerDocument : null
        } catch (error) { doc = null }
        if (doc == null) return undefined
        markSettingsNav(doc)
        const view = doc.defaultView
        const Observer = view != null ? view.MutationObserver : undefined
        if (typeof Observer !== 'function' || typeof doc.querySelector !== 'function') return undefined
        const nav = doc.querySelector('[role="dialog"] nav')
        if (nav == null) return undefined
        const observer = new Observer(function () { markSettingsNav(doc) })
        observer.observe(nav, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true })
        return function () { observer.disconnect() }
      })
      return h('span', { key: 'navmark', style: { display: 'none' }, ref: function (next) { node = next } })
    }
