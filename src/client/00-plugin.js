return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) {
      console.error('git panel: the slots Service is unavailable')
      return
    }

    const h = React.createElement

    /* ── the parts of React this file uses, and what to do without them ──

       The page hands over the real React, so all three of these exist where the
       plugin actually runs. They are guarded because the suites that render this
       file drive it with a forty-line stand-in that only has createElement and
       the two hooks, and a missing optimisation must never be the difference
       between a test that runs and one that throws. Without `memo` a component
       is simply itself; without `useMemo`/`useCallback` the factory just runs. */
    const memo = typeof React.memo === 'function' ? React.memo : function (component) { return component }
    const useMemo = typeof React.useMemo === 'function' ? React.useMemo : function (factory) { return factory() }
    const useCallback = typeof React.useCallback === 'function' ? React.useCallback : function (fn) { return fn }
    /* Layout effects exist to keep a measurement out of the painted frame; where
       there is no layout, there is nothing to keep it out of. */
    const useLayoutEffect = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect

