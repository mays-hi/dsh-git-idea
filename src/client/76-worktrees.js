    /* ── 工作树（只读）──

       DSH 0.2 自己会造工作树：模型调 `create_worktree`，服务把新树建在**源仓库
       里面**的 `.agents/worktrees/<branch>`（默认池），然后把会话的生效目录搬
       过去（Host 侧见 67-worktrees.js）。这个插件对这件事的贡献只有"说清楚"：

       1. 一个页签，列出这个仓库的每一棵工作树 —— 在哪、停在哪个分支和提交上、
          有没有被锁住、能不能清理，以及**当前这一份**是哪一棵；
       2. 点一行，把这**个面板**切过去看。只切视图：模型在哪个目录里干活是模型和
          DSH 的事，这个插件不搬会话（插件也不注册任何工具、不注入提示词）；
       3. 源仓库的改动列表里，那条 `.agents/` 未跟踪改动会被标出来 —— 那是工作树
          池，不是读者改出来的东西。

       chip 上"现在在哪棵树上"不在这里：那是**最前面那颗图标自己换**（见 92-chip.js
       与 42-tree.js 的 WorktreeIcon），不额外挂一颗。

       这里**没有**按仓库的记忆（分支列表有，这份没有）：做过一份，为了"切回读过的
       仓库时页签第一帧就有东西"，但它换来一个竞态 —— 挂载时那次 fresh 读已经回来
       了，紧接着迟到的面板答复又把陈旧的那份盖回去。而它要遮的那半帧其实不存在：
       面板开在「历史」上，清单在读者点「工作树」之前早就到了。 */

    /* ── 一条改动是不是"工作树自己的东西" ──

       git 会把整棵未跟踪目录折叠成一条：池里只有工作树时，源仓库的 status 报
       的是 `?? .agents/`，而不是 `.agents/worktrees/w1/`。所以这里答的是"这条
       路径**盖住**了工作树池或某棵工作树"，而不是"它等于某一棵"。

       答出来只用于**标记**，绝不用于隐藏：`.agents/` 里完全可能还放着读者自己
       的文件（实测：放一个别的文件进去，git 依旧只报 `.agents/`），藏掉这条就
       等于把那个文件一起藏了。 */
    /* 这里只答「这条改动是什么」。它以前还要凑两句给悬浮提示的解释 ——「这是 DSH
       的工作树池，不是你改的东西，可以加进 .gitignore」「它是不是当前这一份检出」——
       现在那两句住在工作树页签的标题下面（见 WorktreePane），那里本来就在解释这件
       事，而且是看得见的一行。 */
    function worktreeNote(data, path) {
      if (data == null || data.ok !== true) return null
      let rel = text(path).replace(/\\/g, '/')
      while (rel.length > 1 && rel.charAt(rel.length - 1) === '/') rel = rel.slice(0, -1)
      if (rel.length === 0) return null
      const pool = text(data.pool).replace(/\\/g, '/').replace(/\/+$/, '')
      if (pool.length > 0 && (rel === pool || pool.indexOf(rel + '/') === 0)) return '工作树池'
      const entries = Array.isArray(data.entries) ? data.entries : []
      for (let i = 0; i < entries.length; i += 1) {
        const at = text(entries[i].rel).replace(/\\/g, '/').replace(/\/+$/, '')
        if (at.length === 0) continue
        if (at === rel || at.indexOf(rel + '/') === 0) return entries[i].current === true ? '当前工作树' : '工作树'
      }
      return null
    }

    /* 这个仓库现在认得几棵树：清单还没回来，或者读失败了，都是 0。调用方拿这个数
       自己说话（页签上的徽标），不再各自算一遍。 */
    function worktreeCount(data) {
      if (data == null || data.ok !== true || !Array.isArray(data.entries)) return 0
      return data.entries.length
    }

    /* 这一份读失败了，到底该说哪一句。Host 用 `error` 说原因（`no-path` /
       `not-a-repository`），`noGit` 说那台机器上没有 git；**没有** `reason` —— 那
       是面板那几位读的字段，曾经照着它们抄了一份判断，"还不知道工作区在哪"因此永远
       说不出口，每种失败都被说成"不是一个 Git 仓库"。 */
    function worktreeReason(data) {
      const reason = text(data != null ? data.error : '')
      if (reason === 'no-path') return '还不知道这个会话的工作区在哪 —— 没法读它的工作树。'
      if (data != null && data.noGit === true) return '这台机器上找不到 git —— 工作树要 git 才读得到。'
      return '读不到这个目录的工作树：它不是一个 Git 仓库，或者 git 拒绝了这次读。'
    }

    /* ── 一行一棵树 ──

       排序交给 Host：`git worktree list` 的第一条就是主工作树，其余按 git 自己
       的顺序。这里只决定怎么说。 */
    function WorktreePane(props) {
      const data = props.data
      if (data == null) {
        return h('div', { className: 'dsh-git-pane dsh-git-dim' }, '正在读取工作树…')
      }
      if (data.ok !== true) {
        return h('div', { className: 'dsh-git-pane dsh-git-error' }, worktreeReason(data))
      }
      const entries = Array.isArray(data.entries) ? data.entries : []
      const current = text(data.current)
      const rows = []
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i]
        const path = text(entry.path)
        const name = text(entry.name)
        const here = entry.current === true
        const badges = []
        if (entry.main === true) badges.push(h('span', { key: 'm', className: 'dsh-git-wt-badge' }, '主'))
        if (here) badges.push(h('span', { key: 'c', className: 'dsh-git-wt-badge dsh-git-wt-badge-on' }, '当前'))
        /* git 给这两个徽标的原因（锁是谁加的、为什么可以清理）跟着这一行的 detail
           走：那里是看得见的文字，也已经有省略号，长理由不会撑破这一行。 */
        const detail = []
        if (text(entry.short).length > 0) detail.push(text(entry.short))
        if (text(entry.subject).length > 0) detail.push(text(entry.subject))
        if (entry.locked === true) {
          badges.push(h('span', { key: 'l', className: 'dsh-git-wt-badge dsh-git-wt-badge-warn' }, '锁定'))
          detail.push(text(entry.lockReason).length > 0 ? '锁定：' + text(entry.lockReason) : '已锁定（git 不会清理它）')
        }
        if (entry.prunable === true) {
          badges.push(h('span', { key: 'p', className: 'dsh-git-wt-badge dsh-git-wt-badge-warn' }, '可清理'))
          detail.push(text(entry.pruneReason).length > 0 ? '可以清理：' + text(entry.pruneReason) : '目录已经不在了，只剩记录')
        }
        rows.push(h('button', {
          key: path,
          type: 'button',
          className: 'dsh-git-wt-row' + (here ? ' dsh-git-wt-row-on' : ''),
          onClick: function () { if (!here && typeof props.onOpen === 'function') props.onOpen(path) },
        },
          h('span', { key: 'ico', className: 'dsh-git-wt-ico' }, h(WorktreeIcon, { size: 13 })),
          h('span', { key: 'main', className: 'dsh-git-wt-main' },
            h('span', { key: 'name', className: 'dsh-git-wt-name' }, name.length > 0 ? name : (entry.detached === true ? 'HEAD（游离）' : '(无名)')),
            h('span', { key: 'path', className: 'dsh-git-wt-path' }, path)),
          h('span', { key: 'meta', className: 'dsh-git-wt-meta' }, detail.join(' · ')),
          badges.length > 0 ? h('span', { key: 'badges', className: 'dsh-git-wt-badges' }, badges) : null))
      }
      return h('div', { className: 'dsh-git-pane dsh-git-wtpane' },
        h('div', { key: 'head', className: 'dsh-git-wt-head' },
          h('span', { key: 'title', className: 'dsh-git-wt-title' },
            entries.length > 1 ? String(entries.length) + ' 棵工作树' : '这个仓库只有一棵工作树'),
          h('span', { key: 'hint', className: 'dsh-git-hint' },
            'DSH 的 create_worktree 建出的新树会出现在这里，落在源仓库的 ' + text(data.pool) + ' 里，'
            + '所以源仓库的改动列表里会出现一条 .agents/ 未跟踪改动 —— 那不是你改出来的东西，'
            + '想让它别再出现可以把它加进 .gitignore。点一行只切换这个面板看哪一棵，不会移动会话。')),
        rows.length > 0 ? h('div', { key: 'rows', className: 'dsh-git-wt-rows' }, rows) : null,
        entries.length <= 1
          ? h('div', { key: 'one', className: 'dsh-git-wt-empty dsh-git-dim' },
              '这个目录就是它自己那份检出' + (current.length > 0 ? '：' + current : '') + '。')
          : null)
    }
