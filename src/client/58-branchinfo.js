    /* git puts what is worth reading in stderr for one command and stdout for
       the next — `switch` narrates itself on stderr while a conflicting
       `stash pop` narrates the merge on stdout — so callers show whichever has
       something in it rather than picking one and showing nothing. */
    function commandDetail(result) {
      if (result == null) return ''
      const err = text(result.stderr).replace(/\s+$/, '')
      if (err.length > 0) return err.slice(0, 400)
      return text(result.stdout).replace(/\s+$/, '').slice(0, 400)
    }

    function branchRelative(seconds) {
      if (!(seconds > 0)) return ''
      const now = Math.floor(Date.now() / 1000)
      if (!(now > 0) || now < seconds) return ''
      const diff = now - seconds
      if (diff < 60) return '刚刚'
      if (diff < 3600) return String(Math.floor(diff / 60)) + ' 分钟前'
      if (diff < 86400) return String(Math.floor(diff / 3600)) + ' 小时前'
      if (diff < 2592000) return String(Math.floor(diff / 86400)) + ' 天前'
      if (diff < 31536000) return String(Math.floor(diff / 2592000)) + ' 个月前'
      return String(Math.floor(diff / 31536000)) + ' 年前'
    }

    /* What the ↙/↗ numbers beside a branch mean, spelled out for the tooltip. The
       numbers themselves come from the Host, which pins git's locale so the
       counts can be read out of %(upstream:track) at all. */
    function trackTitle(ahead, behind) {
      if (ahead > 0 && behind > 0) return '与上游分岔：领先 ' + String(ahead) + '，落后 ' + String(behind)
      if (ahead > 0) return '领先上游 ' + String(ahead) + ' 个提交'
      if (behind > 0) return '落后上游 ' + String(behind) + ' 个提交'
      return '与上游一致'
    }

    /* ── how this browser likes the branch list ──

       Recently used, favourites and the order are all presentation, so they live
       in the same browser-local storage as the rest of layer one — in their own
       keys rather than inside the settings object, because they are written on
       every switch rather than when someone opens the settings page. */
    const MRU_KEY = 'dsh.git-idea.mru'
    const STARS_KEY = 'dsh.git-idea.stars'
    const SORT_KEY = 'dsh.git-idea.sort'
    const MRU_MAX = 8
    const STARS_MAX = 40

    let recentBranches = []
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
      recentBranches = stringList(readStoredJSON(MRU_KEY, null), MRU_MAX)
      starredBranches = stringList(readStoredJSON(STARS_KEY, null), STARS_MAX)
      const sort = readStored(SORT_KEY)
      if (sort === 'name' || sort === 'recent') branchSort = sort
    }
    function saveBranchPrefs() {
      writeStoredJSON(MRU_KEY, recentBranches)
      writeStoredJSON(STARS_KEY, starredBranches)
      writeStored(SORT_KEY, branchSort)
    }
    function rememberBranch(name) {
      if (name.length === 0) return
      const next = [name]
      for (let i = 0; i < recentBranches.length && next.length < MRU_MAX; i += 1) {
        if (recentBranches[i] !== name) next.push(recentBranches[i])
      }
      recentBranches = next
      saveBranchPrefs()
      bumpBranchPrefs()
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
      recentBranches = []
      starredBranches = []
      saveBranchPrefs()
      bumpBranchPrefs()
    }

