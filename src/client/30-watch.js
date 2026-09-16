    /* ── change monitoring ──

       Reads do not age out on the Host, so freshness comes from noticing that
       the repository itself moved. One poller per repository, shared: the panel
       registers fast while it is open (it is what is on screen), the composer
       chip slow. A tick is skipped while the page is hidden, and the first tick
       only records the starting signature so opening a panel never triggers a
       gratuitous reload. */

    const repoWatchers = {}
    let watchPageDoc = null

    function watcherFor(repo) {
      if (repoWatchers[repo] === undefined) {
        repoWatchers[repo] = { listeners: new Set(), fast: 0, deep: 0, stop: null, sig: null, busy: false, sessionId: undefined }
      }
      return repoWatchers[repo]
    }

    function watcherInterval(entry) {
      const sec = entry.fast > 0 ? gitSettings.watchFastSec : gitSettings.watchSlowSec
      return (sec > 0 ? sec : 3) * 1000
    }

    function watcherSchedule(repo) {
      const entry = repoWatchers[repo]
      if (entry === undefined) return
      if (entry.stop != null) { entry.stop(); entry.stop = null }
      const timer = ctx.get('timer')
      if (timer === undefined) return
      if (gitSettings.watchEnabled !== true || entry.listeners.size === 0) return
      entry.stop = timer.interval(function () {
        if (entry.busy) return
        if (watchPageDoc != null && watchPageDoc.hidden === true) return
        entry.busy = true
        const request = repo.length > 0 ? { repo: repo } : {}
        if (request.repo === undefined) request.sessionId = entry.sessionId
        /* Only while something is showing the working tree: the deep signature
           is the one that notices edits inside files, and it is the expensive
           one — seconds on a slow mount, every tick. */
        if (entry.deep > 0) request.deep = true
        callHost('git/watch', request).then(function (data) {
          entry.busy = false
          if (data == null || data.ok !== true) return
          const next = text(data.sig)
          if (entry.sig === null || entry.sig === next) { entry.sig = next; return }
          entry.sig = next
          callHost('git/flush', request).catch(function () {})
          entry.listeners.forEach(function (listener) { listener() })
        }).catch(function () { entry.busy = false })
      }, watcherInterval(entry))
    }

    function rescheduleWatchers() {
      const keys = Object.keys(repoWatchers)
      for (let i = 0; i < keys.length; i += 1) watcherSchedule(keys[i])
    }

    function watchRepo(repo, sessionId, listener, fast, deep) {
      const entry = watcherFor(repo)
      entry.sessionId = sessionId
      entry.listeners.add(listener)
      if (fast === true) entry.fast += 1
      if (deep === true) entry.deep += 1
      if (watchPageDoc == null) {
        const node = chipNode != null ? chipNode : panelNode
        const doc = node != null ? node.ownerDocument : null
        if (doc != null) watchPageDoc = doc
      }
      watcherSchedule(repo)
      return function () {
        entry.listeners.delete(listener)
        if (fast === true && entry.fast > 0) entry.fast -= 1
        if (deep === true && entry.deep > 0) entry.deep -= 1
        watcherSchedule(repo)
      }
    }

