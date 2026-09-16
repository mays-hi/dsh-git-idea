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

    /* ── asking the Host ──

       One door to the Host, because there is one thing every call has to survive:
       the Host half of the bridge reads its own source file when the plugin
       starts, and this half can be mounted before that read lands. A call that
       arrives first is refused with "... is not registered" — it never reached a
       handler, so it is safe to ask again a moment later. Without this the panel
       mounts, every request it makes is refused once, and it stays empty until
       something happens to re-read.

       The retry is deliberately finite: a Host that is genuinely gone has to end
       as an error the reader can see, not as a request that never comes back. */
    const HOST_NOT_READY = 'is not registered'
    const HOST_RETRY_MAX = 24
    const HOST_RETRY_MS = 120

    function hostWait(ms) {
      return new Promise(function (resolve) {
        const timer = ctx.get('timer')
        if (timer === undefined) { resolve(); return }
        timer.timeout(function () { resolve() }, ms)
      })
    }

    function callHost(method, payload, left) {
      return host.call(method, payload).catch(function (failure) {
        const remaining = left === undefined ? HOST_RETRY_MAX : left
        const waiting = remaining > 0 && failureText(failure).indexOf(HOST_NOT_READY) >= 0
        if (waiting !== true) throw failure
        return hostWait(HOST_RETRY_MS).then(function () { return callHost(method, payload, remaining - 1) })
      })
    }

    /* A command that ran and failed is not a transport error either: the Host
       answers `{ok:false, stderr}` because git's own sentence is what the reader
       needs to see. So every operation had two failure paths to write — the
       `ok !== true` branch and the `catch` — and they forget different things (a
       busy flag, a reload, the armed-delete row). This collapses them: the
       failure arrives at one handler, carrying git's words as the Error message.

       The whole reply stays reachable as `failure.reply` for the callers that
       have to look further — `stashed`, `popConflict`, `error`. A transport
       failure has no `reply`, which is how `undefined` here came to mean "the
       Host never answered". (`commandDetail` is defined further down; the two are
       both function declarations in this one scope, so order does not matter.) */
    function rpc(method, payload, fallback) {
      return callHost(method, payload).then(function (result) {
        if (result != null && result.ok === true) return result
        const failure = new Error(commandDetail(result) || fallback || '操作失败')
        failure.reply = result
        failure.method = method
        throw failure
      }, function (transport) {
        const failure = new Error(failureText(transport))
        failure.method = method
        throw failure
      })
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

    function readStored(key) {
      const store = localStore(null)
      if (store == null) return null
      try {
        return store.getItem(key)
      } catch (error) {
        return null
      }
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
    /* Set by the switcher while one of its operations is in flight. Clicking
       "check out" collapses the flyout under the pointer, which counts as
       leaving the card — without this the card closed itself 200ms later and
       the checkout's own answer (the new branch, or why it failed) was thrown
       away unread, which looks exactly like the click doing nothing. */
    let switchBusy = false

    function hoverCloseSoon() {
      clearHoverTimer()
      if (switchMode !== 'hover') return
      if (switchBusy === true) return
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
