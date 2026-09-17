})()

/* The body's own apply, plus the one thing the bridge used to own: the
   transport to the browser half. \`webServer\` is optional at the type level but
   present in every web profile; without it the panel goes quiet and nothing
   else changes. */
export function apply(ctx, config) {
  ctx.inject(['webServer'], function (scope) {
    scope.effect(function () {
      return scope.webServer.register({ kind: 'exact', path: RPC_PATH, handler: rpcRoute })
    }, 'dsh-git-idea rpc route')
  })
  return plugin.apply(ctx, config)
}

/* No hard dependency to declare. Every service the fragments use — \`shell\`,
   \`fs\`, \`timer\`, \`sandboxPolicy\`, \`sessions\` — is read with \`ctx.get\` and
   guarded, and the RPC route waits for \`webServer\` through \`ctx.inject\` above. */
