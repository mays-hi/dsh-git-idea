    /* ── 工作区里的仓库：清单里那一行 ──

       `git/repos`（Host 扫出来的那张清单，见 69-repos.js）有两个地方要画：面板头上那颗
       「仓库」chip 展开的卡片，和输入框旁悬浮卡片顶上那一段。同一份读数、同一件事，行就
       该是同一行 —— 所以它住在这里（70 的分支卡片和 80 的面板都要用，而片段的规矩是
       只能用上面片段定义的东西）。

       名字用清单里的相对路径（`apps/web`）：两个项目同名时，只有相对路径分得开。 */
    function repoLabel(root) {
      const rel = text(root.rel)
      return rel.length > 0 ? rel : pathBase(root.path)
    }

    function repoRow(root, here, active, onPick) {
      const branch = text(root.branch)
      return h('button', {
        key: root.path, type: 'button',
        className: 'dsh-git-root-row'
          + (here === true ? ' dsh-git-root-row-on' : '')
          + (active === true ? ' dsh-git-root-row-hl' : ''),
        onClick: function (event) { stopEvent(event); onPick(root.path) },
        'aria-label': (here === true ? '现在看的就是这个仓库：' : '换成看这个仓库：') + root.path
          + (branch.length > 0 ? '（分支 ' + branch + '）' : ''),
      },
        h('span', { key: 'c', className: 'dsh-git-root-cur' }, here === true ? '★' : ''),
        /* 一颗文件夹字形：它和下面那些分支行在同一张清单里，行首有记号才分得清
           「这是一个仓库」和「这是一个分支」。 */
        h('span', { key: 'i', className: 'dsh-git-root-ico' }, h(Icon, { name: 'folder', size: 12 })),
        h('span', { key: 'n', className: 'dsh-git-root-name' }, repoLabel(root)),
        branch.length > 0 ? h('span', { key: 'b', className: 'dsh-git-root-branch' }, branch) : null,
        h('span', { key: 'p', className: 'dsh-git-root-path' }, root.path))
    }

    /* 清单里哪一条是「现在看的这一个」；手上的路径为空时退回仓库读回来的那一个。 */
    function repoHere(list, repo, fallback) {
      const target = repo.length > 0 ? repo : fallback
      if (target.length === 0) return null
      for (let i = 0; i < list.length; i += 1) {
        if (sameRepoPath(list[i].path, target)) return list[i]
      }
      return null
    }
