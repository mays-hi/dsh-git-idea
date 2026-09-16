    function text(value) {
      return typeof value === 'string' ? value : ''
    }

    const listeners = new Set()
    let open = false
    const setOpen = function (next) {
      if (open === next) return
      open = next
      listeners.forEach(function (listener) { listener() })
    }
    const useOpen = function () {
      const pair = React.useState(open)
      React.useEffect(function () {
        const listener = function () { pair[1](open) }
        listeners.add(listener)
        return function () { listeners.delete(listener) }
      }, [])
      return pair[0]
    }

    let chipNode = null
    let panelNode = null
    let everOpened = false

    /* One version counter for "the repository moved", shared by every surface
       that shows it. A switch made from the hover card happens while the panel
       is closed and the chip is the only thing on screen, so a counter owned by
       one component would leave the other one naming the branch it used to be
       on; and the panel itself stays mounted now, so it has to hear about a
       change that happened while it was hidden. */
    const dataListeners = new Set()
    let dataVersion = 0
    const bumpData = function () {
      dataVersion += 1
      dataListeners.forEach(function (listener) { listener() })
    }
    const useDataVersion = function () {
      const pair = React.useState(dataVersion)
      React.useEffect(function () {
        const listener = function () { pair[1](dataVersion) }
        dataListeners.add(listener)
        return function () { dataListeners.delete(listener) }
      }, [])
      return pair[0]
    }

    /* Which switcher is showing, if either: the dropdown hanging off the panel
       header's branch chip ('panel'), or the card the composer chip opens on
       hover ('hover'). One at a time, never both with the panel. */
    const switchListeners = new Set()
    let switchMode = null
    let switcherNode = null
    const setSwitchMode = function (next) {
      if (switchMode === next) return
      switchMode = next
      switchListeners.forEach(function (listener) { listener() })
    }
    const useSwitchMode = function () {
      const pair = React.useState(switchMode)
      React.useEffect(function () {
        const listener = function () { pair[1](switchMode) }
        switchListeners.add(listener)
        return function () { switchListeners.delete(listener) }
      }, [])
      return pair[0]
    }

    /* Hover is a promise the pointer can break at any moment, so opening waits
       (a pointer crossing the composer on its way somewhere else must not open
       anything) and closing waits too, or the card would vanish in the gap
       between the chip and itself. */
    let hoverTimer = null
    function clearHoverTimer() {
      if (hoverTimer != null) { hoverTimer(); hoverTimer = null }
    }
    function hoverOpenSoon() {
      clearHoverTimer()
      if (switchMode !== null) return
      const timer = ctx.get('timer')
      if (timer === undefined) return
      hoverTimer = timer.timeout(function () {
        hoverTimer = null
        if (switchMode === null) setSwitchMode('hover')
      }, 180)
    }
    function hoverCloseSoon() {
      clearHoverTimer()
      if (switchMode !== 'hover') return
      const timer = ctx.get('timer')
      if (timer === undefined) { setSwitchMode(null); return }
      hoverTimer = timer.timeout(function () {
        hoverTimer = null
        if (switchMode === 'hover') setSwitchMode(null)
      }, 200)
    }

    /* The applied repository path is remembered per session, never in one
       global slot: one page can host several sessions, and a path applied in
       one workspace must not decide what the chip asks about in another. An
       empty entry means "nothing was applied here", which makes the Host fall
       back to that session's own working directory. */
    const sharedRepos = {}
    function sessionRepo(sessionId) {
      if (sessionId === undefined || sessionId === null) return ''
      const value = sharedRepos[sessionId]
      return typeof value === 'string' ? value : ''
    }
    function rememberRepo(sessionId, next) {
      if (sessionId === undefined || sessionId === null) return
      if (next.length > 0) sharedRepos[sessionId] = next
      else delete sharedRepos[sessionId]
    }

    /* Panel geometry. Zero means "follow the composer width / 74vh", which stays
       the default; the first drag switches to explicit pixels, and the size is
       remembered through localStorage when the page exposes one. */
    let panelSize = { w: 0, h: 0 }
    let panelSizeLoaded = false

    function panelStore(doc) {
      try {
        const view = doc != null ? doc.defaultView : null
        return view != null ? view.localStorage : null
      } catch (error) {
        return null
      }
    }

    /* The plugin answered to "gitops" before it was named dsh-git-idea, and the
       keys it wrote then are the same preferences this version reads now. A
       rename must not silently reset someone's panel size, cadence or
       favourites, so the old key is copied across once, on the first store the
       page hands over, and only when the new one is still absent. */
    const STORE_RENAMES = [
      ['dsh.gitops.settings', 'dsh.git-idea.settings'],
      ['dsh.gitops.panel', 'dsh.git-idea.panel'],
      ['dsh.gitops.mru', 'dsh.git-idea.mru'],
      ['dsh.gitops.stars', 'dsh.git-idea.stars'],
      ['dsh.gitops.sort', 'dsh.git-idea.sort'],
    ]
    let storeMigrated = false
    function migrateStore(doc) {
      if (storeMigrated) return
      storeMigrated = true
      try {
        const store = panelStore(doc)
        if (store == null) return
        for (let i = 0; i < STORE_RENAMES.length; i += 1) {
          const from = STORE_RENAMES[i][0]
          const to = STORE_RENAMES[i][1]
          const previous = store.getItem(from)
          if (previous != null && store.getItem(to) == null) store.setItem(to, previous)
        }
      } catch (error) {
        /* nothing to carry over is not a failure */
      }
    }

    function loadPanelSize(doc) {
      if (panelSizeLoaded) return
      panelSizeLoaded = true
      try {
        const store = panelStore(doc)
        if (store == null) return
        const parsed = JSON.parse(store.getItem('dsh.git-idea.panel') || 'null')
        if (parsed != null && typeof parsed.w === 'number' && typeof parsed.h === 'number') {
          panelSize = { w: parsed.w, h: parsed.h }
        }
      } catch (error) {
        panelSize = { w: 0, h: 0 }
      }
    }

    const panelSizeListeners = new Set()

    function publishPanelSize(next) {
      panelSize = next
      panelSizeListeners.forEach(function (listener) { listener() })
    }

    function savePanelSize(doc) {
      try {
        const store = panelStore(doc)
        if (store != null) store.setItem('dsh.git-idea.panel', JSON.stringify(panelSize))
      } catch (error) {
        /* a refused preference is not worth breaking the panel over */
      }
    }

