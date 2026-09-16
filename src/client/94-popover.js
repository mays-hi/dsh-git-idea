    function GitPopover(props) {
      const isOpen = useOpen()
      const mode = useSwitchMode()
      /* Unmounting on close threw away the tab, the filters, the selection and
         the scroll position, and made every reopen a fresh mount that re-read
         everything. Closing now only hides it: the panel keeps its state, and
         nothing is fetched again until something actually changes. */
      if (isOpen) everOpened = true

      React.useEffect(function () {
        if (!isOpen && mode === null) return undefined
        let doc = null
        try {
          const from = switcherNode != null ? switcherNode : (panelNode != null ? panelNode : chipNode)
          doc = from != null ? from.ownerDocument : null
        } catch (error) { doc = null }
        if (doc == null) return undefined
        const onPointerDown = function (event) {
          const target = event.target
          if (target == null || typeof target.nodeType !== 'number') return
          const inChip = chipNode != null && chipNode.contains(target)
          const inCard = switcherNode != null && switcherNode.contains(target)
          /* The panel is the thing on screen whether or not the switcher hangs
             off it. Gating this on the switcher being open was a real bug: with
             nothing open, every click inside the panel counted as an outside
             click and closed it. */
          const inPanel = panelNode != null && panelNode.contains(target)
          if (inChip || inCard) return
          if (switchMode !== null) {
            /* Clicking the panel behind the open switcher dismisses the switcher
               — and only the switcher, because the click did land on the panel. */
            setSwitchMode(null)
            if (inPanel) return
          }
          if (inPanel) return
          setOpen(false)
        }
        const onKeyDown = function (event) {
          if (event.key !== 'Escape') return
          /* Escape closes the innermost thing first, so dismissing the switcher
             does not also throw away the panel behind it. */
          if (switchMode !== null) { setSwitchMode(null); return }
          setOpen(false)
        }
        doc.addEventListener('pointerdown', onPointerDown, true)
        doc.addEventListener('keydown', onKeyDown, true)
        return function () {
          doc.removeEventListener('pointerdown', onPointerDown, true)
          doc.removeEventListener('keydown', onKeyDown, true)
        }
      }, [isOpen, mode])

      /* display:contents so the wrapper adds no box: the panel keeps positioning
         itself against the same ancestor it always did, and the hover card is an
         absolutely positioned sibling that cannot push it around. */
      return h('div', { className: 'gitops-layer' },
        h(GitPanel, { key: 'panel', sessionId: props.sessionId, active: isOpen, ready: everOpened }),
        mode === 'hover' && isOpen !== true
          ? h('div', {
              key: 'switch', className: 'gitops-switch gitops-switch-hover',
              ref: function (node) { switcherNode = node },
              onPointerEnter: function () { clearHoverTimer() },
              onPointerLeave: function () { hoverCloseSoon() },
            }, h(BranchPicker, {
              sessionId: props.sessionId,
              repo: chipInfoFor(props.sessionId).repo.length > 0
                ? chipInfoFor(props.sessionId).repo
                : sessionRepo(props.sessionId),
              mode: 'hover',
              dirty: chipInfoFor(props.sessionId).pending,
              onDone: function () { setSwitchMode(null) },
              onClose: function () { setSwitchMode(null) },
            }))
          : null)
    }
