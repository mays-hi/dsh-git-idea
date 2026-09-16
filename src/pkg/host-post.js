})()

/* The body's own apply, plus the one thing the bridge used to own: the
   transport to the browser half. \`webServer\` is optional at the type level but
   present in every web profile; without it the model tools still register and
   only the panel goes quiet. */
export function apply(ctx, config) {
  ctx.inject(['webServer'], function (scope) {
    scope.effect(function () {
      return scope.webServer.register({ kind: 'exact', path: RPC_PATH, handler: rpcRoute })
    }, 'dsh-git-idea rpc route')
  })
  return plugin.apply(ctx, config)
}

/* \`tools\` is the only hard dependency: every fragment reaches it through
   \`harness.registerTool\`. Every other service is read with \`ctx.get\` and guarded. */
export const inject = ['tools']
