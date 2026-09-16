    function text(value) {
      return typeof value === 'string' ? value : ''
    }

    /* Whatever was thrown, said in one line. Every catch in this file wants the
       same sentence, and the shape it guards against — a rejection that is a
       string rather than an Error — is the one that would otherwise print
       "undefined". */
    function failureText(failure) {
      return String(failure != null && failure.message !== undefined ? failure.message : failure)
    }

    /* ── one signal, seven of them ──

       Every piece of state that two surfaces have to agree on is the same three
       things: a value, a set of listeners, and a hook that re-renders its
       component when one of them fires. Written out seven times, that is seven
       chances for a notification to be forgotten on one path and sent twice on
       another — and it was, in both directions. It is written once here; what
       differs between the seven (whether an identical value may be set again,
       where the value is persisted, whether it counts or holds) stays in the
       section that owns it.

       The reader is a function rather than a value, so the variable each section
       already keeps — `open`, `panelSize`, `gitSettings` — stays the truth and
       every existing read of it stays a plain read. */
    function createSignal(read) {
      const listeners = new Set()
      const signal = {
        /* Tell everyone. Called by whoever just changed the value, never by the
           subscribers, so a notification always follows a real change. */
        notify: function () {
          listeners.forEach(function (listener) { listener() })
        },
        subscribe: function (listener) {
          listeners.add(listener)
          return function () { listeners.delete(listener) }
        },
        /* The React face of the signal: read the value when the signal fires,
           never the one this render closed over. */
        use: function () {
          const pair = React.useState(read())
          React.useEffect(function () {
            return signal.subscribe(function () { pair[1](read()) })
          }, [])
          return pair[0]
        },
      }
      return signal
    }

    /* ── the browser's own storage ──

       A page can refuse storage at any point — private mode, a sandboxed frame,
       a quota — and not one of the preferences below is worth breaking the panel
       over. So every read and write goes through here, the try/catch lives here,
       and the sections above only name a key.

       The first document that hands over a panel or chip node is kept, because a
       save can happen long after the node that prompted it is gone. */
    let settingsDoc = null

    function localStore(doc) {
      if (doc != null && settingsDoc == null) settingsDoc = doc
      if (settingsDoc == null) return null
      try {
        const view = settingsDoc.defaultView
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

    function readStored(key) {
      const store = localStore(null)
      if (store == null) return null
      let value = null
      try {
        if (storeMigrated !== true) {
          storeMigrated = true
          for (let i = 0; i < STORE_RENAMES.length; i += 1) {
            const from = STORE_RENAMES[i][0]
            const to = STORE_RENAMES[i][1]
            const previous = store.getItem(from)
            if (previous != null && store.getItem(to) == null) store.setItem(to, previous)
          }
        }
        value = store.getItem(key)
      } catch (error) {
        return null
      }
      return value
    }

    function writeStored(key, value) {
      const store = localStore(null)
      if (store == null) return
      try {
        store.setItem(key, value)
      } catch (error) {
        /* a refused preference is not worth breaking the panel over */
      }
    }

    function readStoredJSON(key, fallback) {
      const raw = readStored(key)
      if (raw == null) return fallback
      try {
        return JSON.parse(raw)
      } catch (error) {
        return fallback
      }
    }

    function writeStoredJSON(key, value) {
      writeStored(key, JSON.stringify(value))
    }

    /* Whether the panel is open at all: the composer chip and the panel are two
       components racing to be the same answer. */
    let open = false
    const openSignal = createSignal(function () { return open })
    const setOpen = function (next) {
      if (open === next) return
      open = next
      openSignal.notify()
    }
    const useOpen = openSignal.use

    let chipNode = null
    let panelNode = null
    let everOpened = false

    /* One version counter for "the repository moved", shared by every surface
       that shows it. A switch made from the hover card happens while the panel
       is closed and the chip is the only thing on screen, so a counter owned by
       one component would leave the other one naming the branch it used to be
       on; and the panel itself stays mounted now, so it has to hear about a
       change that happened while it was hidden. */
    let dataVersion = 0
    const dataSignal = createSignal(function () { return dataVersion })
    const bumpData = function () {
      dataVersion += 1
      dataSignal.notify()
    }
    const useDataVersion = dataSignal.use

    /* Which switcher is showing, if either: the dropdown hanging off the panel
       header's branch chip ('panel'), or the card the composer chip opens on
       hover ('hover'). One at a time, never both with the panel. */
    let switchMode = null
    let switcherNode = null
    const switchSignal = createSignal(function () { return switchMode })
    const setSwitchMode = function (next) {
      if (switchMode === next) return
      switchMode = next
      switchSignal.notify()
    }
    const useSwitchMode = switchSignal.use

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

    /* ── panel geometry ──

       Zero means "follow the composer width / 74vh", which stays the default;
       the first drag switches to explicit pixels, and the size is remembered
       through localStorage when the page exposes one. */
    const PANEL_SIZE_KEY = 'dsh.git-idea.panel'
    let panelSize = { w: 0, h: 0 }
    let panelSizeLoaded = false
    const panelSizeSignal = createSignal(function () { return panelSize })

    function publishPanelSize(next) {
      panelSize = next
      panelSizeSignal.notify()
    }

    function loadPanelSize(doc) {
      if (panelSizeLoaded) return
      panelSizeLoaded = true
      localStore(doc)
      const parsed = readStoredJSON(PANEL_SIZE_KEY, null)
      if (parsed != null && typeof parsed.w === 'number' && typeof parsed.h === 'number') {
        panelSize = { w: parsed.w, h: parsed.h }
      }
    }

    function savePanelSize() {
      writeStoredJSON(PANEL_SIZE_KEY, panelSize)
    }
