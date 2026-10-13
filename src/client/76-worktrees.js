    /* ── 工作树：客户端这一侧只剩一条注解 ──

       DSH 0.2 自己会造工作树：模型调 `create_worktree`，服务把新树建在**源仓库
       里面**的 `.agents/worktrees/<branch>`（默认池），然后把会话的生效目录搬
       过去（Host 侧见 67-worktrees.js）。这个插件对这件事只说一件：**源仓库改动
       列表里那条 `.agents/` 是什么**（下面的 `worktreeNote`）。

       ── 这里曾经还有一份清单，为什么没有了 ──

       这份文件原来还画一份「这个仓库的每一棵树」的清单（先是第三个页签，后来搬进
       面板头上那颗「仓库」chip 里当第二组）：在哪、停在哪个提交、锁没锁、能不能
       清理，点一行换这个面板看哪一棵。现在没有了 —— 「换这个面板看哪一个」这件事
       有一个家就够，而那颗 chip 的家是**工作区里的仓库**（`git/repos`，见
       69-repos.js），和输入框旁那张悬浮卡片同一套逻辑：只列仓库、只有一种可能时
       不出现、点一行换看哪一个。

       工作树是同一个仓库的**第二份检出**（自己的目录、索引、HEAD；分支是几棵树
       共享的），把它排进那张清单，屏幕上就多出一个只在 DSH 建过树之后才存在的
       概念；而"现在在哪棵树上"这件事，最前面那颗 chip 自己用字形说（见 92-chip.js
       与 60-icons.js 的 WorktreeIcon）。`git/worktrees` 这份读因此只服务一件事：
       认出改动列表里那条 `.agents/`。 */

    /* ── 一条改动是不是"工作树自己的东西" ──

       git 会把整棵未跟踪目录折叠成一条：池里只有工作树时，源仓库的 status 报
       的是 `?? .agents/`，而不是 `.agents/worktrees/w1/`。所以这里答的是"这条
       路径**盖住**了工作树池或某棵工作树"，而不是"它等于某一棵"。

       答出来只用于**标记**，绝不用于隐藏：`.agents/` 里完全可能还放着读者自己
       的文件（实测：放一个别的文件进去，git 依旧只报 `.agents/`），藏掉这条就
       等于把那个文件一起藏了。 */
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
