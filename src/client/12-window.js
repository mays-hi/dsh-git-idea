    /* ── long lists, short renders ──

       The history is one row per commit and can run to a few hundred of them.
       Every render of the panel used to rebuild all of them, including the ones
       scrolled far out of sight, and a panel render happens for things that have
       nothing to do with the list — a keystroke in the search box, a hover.

       A commit row is exactly ROW_H tall and rows are told apart by nothing but
       their index, so which ones are on screen is arithmetic. The one thing that
       has to come from the page is how tall the scroller is; until it says (a
       test harness reports no height, and neither does a browser that has not
       laid the panel out yet) the window is "everything", which is what this did
       before, so a failed measurement can never make a row disappear. */
    const VIRTUAL_OVERSCAN = 8
    const scrollNodes = {}

    function useVirtualWindow(id, count, rowHeight) {
      const [win, setWin] = React.useState(null)
      /* One identity for the life of the list: a ref callback rebuilt on every
         render makes React detach it and re-attach the node, which would blank
         the measurement in between for no reason at all. */
      const attach = useCallback(function (node) { scrollNodes[id] = node }, [id])
      const measure = function () {
        const node = scrollNodes[id]
        const viewport = node != null && typeof node.clientHeight === 'number' ? node.clientHeight : 0
        if (viewport <= 0) {
          setWin(function (previous) { return previous === null ? previous : null })
          return
        }
        const top = node != null && typeof node.scrollTop === 'number' && node.scrollTop > 0 ? node.scrollTop : 0
        const first = Math.max(0, Math.floor(top / rowHeight) - VIRTUAL_OVERSCAN)
        const last = Math.min(count, Math.ceil((top + viewport) / rowHeight) + VIRTUAL_OVERSCAN)
        setWin(function (previous) {
          if (previous !== null && previous.first === first && previous.last === last) return previous
          return { first: first, last: Math.max(first, last) }
        })
      }
      /* Deliberately no dependency list: measuring is idempotent and costs two
         numbers, and re-taking it after every render is what keeps the window
         honest when the panel is resized, a filter shortens the list, or the
         rows are suddenly laid out at a different size. The state setter bails
         out on an unchanged window, so this cannot loop. */
      useLayoutEffect(function () {
        measure()
        return undefined
      })
      return {
        first: win === null ? 0 : win.first,
        last: win === null ? count : win.last,
        windowed: win !== null,
        measure: measure,
        attach: attach,
      }
    }
