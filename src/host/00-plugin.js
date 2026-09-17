return {
  apply(ctx) {

const shell = ctx.get('shell')
if (shell === undefined) {
  console.error('git plugin: the shell Service is unavailable; no RPC registered')
  return
}

