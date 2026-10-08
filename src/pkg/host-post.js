})()

/* The body's own apply, plus the one thing the bridge used to own: the
   transport to the browser half. `webServer` is optional at the type level but
   present in every web profile; without it the panel goes quiet and nothing
   else changes. */
export function apply(ctx, config) {
  ctx.inject(['webServer'], function (scope) {
    scope.effect(function () {
      /* The route answers for itself (rpcRoute), and what it asks the platform
         is the connection Service: its `requestRejection` is the Host/Origin
         fence plus the browser session, the same gate every shipped route owner
         uses. Read at request time rather than captured here, so a composition
         that brings the carrier up late still gates the route the moment it
         exists — and a composition without one falls back to the fence alone. */
      return scope.webServer.register({
        kind: 'exact',
        path: RPC_PATH,
        handler: function (request, response) { return rpcRoute(request, response, ctx.get('connection')) },
      })
    }, 'dsh-git-idea rpc route')
  })
  return plugin.apply(ctx, config)
}

/* `shell` is the one service the host half cannot do without: every git command
   goes through it. Declared, not only read, because the executor that provides
   it (`bash-sandbox` / `pwsh-sandbox`) is itself parked until `subprocess`,
   `sandbox` and `sandboxPolicy` are ready — so at this plugin's apply time
   `ctx.get('shell')` can still be undefined, and the body's guard would then
   register no RPC at all. Cordis parks this plugin until the service exists;
   `dsh-tool-bash`, the product's own bash tool, declares the same one. The rest
   — `fs`, `timer`, `sandboxPolicy`, `sessions` — stay `ctx.get` reads with
   guards, because a panel without them is still a panel. */
export const inject = ['shell']
