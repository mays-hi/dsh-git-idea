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

    /* ── 会话的**生效**目录，从 DSH 的投影里读 ──

       DSH 0.2 起会话说得清自己现在在哪个目录：`workingDirectory` 是一条 wire
       投影，Host 算、Client 收、随会话推送。标准座位把它交给每一个 session 作用
       域的 slot（`props.useProjection`），于是 chip 和面板不用问 Host 也能在模型
       `create_worktree` / `cd` 之后**立刻**知道"该重新读哪个仓库了" —— 在这
       之前，它们的重读只由"仓库自己动了"触发，而换目录动的是会话，不是仓库。

       老版本 DSH 没有这个座位，那时它返回空串：一切照旧，由 Host 自己解析。 */
    function projectionCwd(props) {
      if (props == null || typeof props.useProjection !== 'function') return ''
      try {
        const cwd = props.useProjection('workingDirectory')
        return typeof cwd === 'string' ? cwd : ''
      } catch (error) {
        return ''
      }
    }

