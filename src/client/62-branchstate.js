    function stopEvent(event) {
      if (event != null && typeof event.stopPropagation === 'function') event.stopPropagation()
    }

    /* The switcher, shared by the panel header's branch chip and the card the
       composer chip opens on hover. Same list, same keys, same rescue: they
       answer the same question, and only where they hang and whether they take
       focus differ.

       Hover mode never focuses its filter. Taking the caret out of the composer
       because a pointer crossed the toolbar would be worse than clicking the box
       yourself, so the card stays passive until it is clicked. */
    /* The last branch list per repository, held here as well as in the Host's
       cache. Opening the card must not show an empty list while a read the Host
       can answer in no time is in flight: the remembered list paints on the
       first frame and the fresh one replaces it a few milliseconds later, which
       is the difference between "waited for it" and "it was already there". */
    const branchCache = {}
    function rememberBranches(repo, data) {
      if (data == null || data.ok !== true) return
      branchCache[repo] = data
    }

    /* The hash the reader picked, mirrored outside React because the history read
       has to know it without depending on it: a dependency on the selection would
       make every click re-read the graph, and reading the state from the effect's
       closure would let an in-flight read undo a click that landed meanwhile. */
    let pickedCommit = ''
    let pickerInputNode = null
    let pickerList = null
    let flyTimer = null
    /* Opening waits so a pointer dragged down the list does not flash a panel at
       every row; closing waits so the trip from the row into the panel, which
       hangs just past the card's edge, does not dismiss it. */
    const FLY_OPEN_MS = 120
    const FLY_CLOSE_MS = 220
    function clearFlyTimer() {
      if (flyTimer != null) { flyTimer(); flyTimer = null }
    }
    /* Everything the composer chip knows is per SESSION, not global: switching
       workspaces used to leave the previous one's repository and branch count on
       screen until the next read came back, which is exactly the lag you feel
       when you switch. */
    const chipInfos = {}
    const chipLabels = {}
    function chipInfoFor(sessionId) {
      const found = chipInfos[sessionId]
      return found !== undefined ? found : { repo: '', pending: 0 }
    }
    function chipLabelFor(sessionId) {
      const found = chipLabels[sessionId]
      return found !== undefined ? found : { phase: 'loading', label: null, pending: 0, repo: '', reason: '' }
    }
    /* One read per repository, and only until it lands: the chip warms the
       switcher's list so the first hover paints from memory instead of from a
       round trip. */
    const branchPrefetching = {}
    function prefetchBranches(sessionId, repo) {
      if (repo == null || repo.length === 0) return
      if (branchCache[repo] !== undefined || branchPrefetching[repo] === true) return
      branchPrefetching[repo] = true
      host.call('git/branches', { sessionId: sessionId, repo: repo }).then(function (list) {
        branchPrefetching[repo] = false
        rememberBranches(repo, list)
      }).catch(function () { branchPrefetching[repo] = false })
    }

