    /* git puts what is worth reading in stderr for one command and stdout for
       the next — `switch` narrates itself on stderr while a conflicting
       `stash pop` narrates the merge on stdout — so callers show whichever has
       something in it rather than picking one and showing nothing. */
    function commandDetail(result) {
      if (result == null) return ''
      /* 和下面沙箱那条同一类：失败的原因不在仓库里，而在机器上。这次 git 一个字
         都没说 —— 它根本没被启动 —— 所以这里给整句话，不留 bash 的原话：原话是
         `bash: git: command not found`，而读者已经从上面那行知道这件事了。 */
      if (result.noGit === true) {
        return '这台机器上找不到 git：面板读它、改它都要调用 git。'
          + '装上 git，或让它出现在 dsh 进程的 PATH 里，再试一次。'
      }
      const err = text(result.stderr).replace(/\s+$/, '')
      const detail = err.length > 0 ? err.slice(0, 400) : text(result.stdout).replace(/\s+$/, '').slice(0, 400)
      /* git 在这件事上说八行，其中七行是建议（"Run git config --global ..."），最后
         一行才是拒绝本身。这里说的是同一件事，但先说面板里能点的那个地方（设置页的
         提交身份），再给能照抄的命令 —— 两条路都留着，因为面板并不总是开着的。 */
      if (result.needsIdentity === true) {
        const lines = err.length > 0 ? err.split('\n') : []
        let last = ''
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          if (lines[i].trim().length > 0) { last = lines[i].trim(); break }
        }
        const why = 'git 不知道这次提交该署谁的名字，所以把它拒了 —— 作者身份写在 git 的配置里，'
          + '不在这个仓库里。设置页「dsh-git-idea配置 → 提交身份」里可以填，'
          + '或者在终端里跑一遍：\n'
          + '  git config --global user.name "你的名字"\n'
          + '  git config --global user.email "你的邮箱"\n'
          + '不加 --global 只对这个仓库生效。'
        /* git 的原话照旧留在下面一行：身份缺失是这次提交过不去的一道坎，但不一定是
           唯一一道 —— 一个失败的钩子、一次没解决的冲突各自另有话说，把那句话丢掉就是
           同一类误诊（"这台机器上没有 git" 曾经也这样盖掉过真正的答案）。 */
        return last.length > 0 ? why + '\n' + last : why
      }
      /* git says "Unable to create ... .git/index.lock: Permission denied", which
         reads as a broken repository. It is the file sandbox refusing the write,
         and the reader can act on that (widen the session's file policy, or move
         the workspace) — so say it, and keep git's own line underneath. */
      if (result.sandboxDenied !== true) return detail
      const why = '文件沙箱不允许写这个仓库：读取没问题，暂存、提交、切换、初始化这类写操作需要这个目录在会话的可写范围内。'
      return detail.length > 0 ? why + '\n' + detail : why
    }

    /* ── how this browser likes the branch list ──

       Favourites and the order are presentation, so they live in the same
       browser-local storage as the rest of layer one — in their own keys rather
       than inside the settings object, because they are written on every switch
       rather than when someone opens the settings page.

       「最近用过的分支」那份记忆在这里没有了：卡片上那一组换成了 HEAD（见
       70-branchpicker.js），而它读的是 Host 清单里带 current 的那一行 —— 一份要
       自己维护、还会过期的副本（切过、删过、在终端里切过）不如没有。 */
    const STARS_KEY = 'dsh.git-idea.stars'
    const SORT_KEY = 'dsh.git-idea.sort'
    const STARS_MAX = 40

    let starredBranches = []
    let branchSort = 'recent'
    let branchPrefsLoaded = false
    /* A counter rather than a value: the two consumers of this signal are the
       switcher and the settings page, and both want a fresh render after any of
       the three lists changed, not the list itself. */
    let branchPrefVersion = 0
    const branchPrefSignal = createSignal(function () { return branchPrefVersion })
    const useBranchPrefs = branchPrefSignal.use

    function bumpBranchPrefs() {
      branchPrefVersion += 1
      branchPrefSignal.notify()
    }
    function stringList(raw, max) {
      const out = []
      if (!Array.isArray(raw)) return out
      for (let i = 0; i < raw.length && out.length < max; i += 1) {
        if (typeof raw[i] === 'string' && raw[i].length > 0 && out.indexOf(raw[i]) < 0) out.push(raw[i])
      }
      return out
    }
    function loadBranchPrefs(doc) {
      localStore(doc)
      if (branchPrefsLoaded) return
      branchPrefsLoaded = true
      starredBranches = stringList(readStoredJSON(STARS_KEY, null), STARS_MAX)
      const sort = readStored(SORT_KEY)
      if (sort === 'name' || sort === 'recent') branchSort = sort
    }
    function saveBranchPrefs() {
      writeStoredJSON(STARS_KEY, starredBranches)
      writeStored(SORT_KEY, branchSort)
    }
    function toggleStar(name) {
      const at = starredBranches.indexOf(name)
      if (at >= 0) starredBranches.splice(at, 1)
      else starredBranches = [name].concat(starredBranches).slice(0, STARS_MAX)
      saveBranchPrefs()
      bumpBranchPrefs()
    }
    function setBranchSort(next) {
      branchSort = next
      saveBranchPrefs()
      bumpBranchPrefs()
    }
    function clearBranchMemory() {
      starredBranches = []
      saveBranchPrefs()
      bumpBranchPrefs()
    }

