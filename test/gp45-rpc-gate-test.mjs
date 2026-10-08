/* ── who may drive git through the packaged Host half ──

   Every panel read and every mutation crosses one route, and `webServer` gates
   nothing by itself: whoever owns the route owns the gate. This suite therefore
   does not read the gate's source, it drives the shipped `lib/index.js` through
   its real registration and asks, request by request, which ones reach a handler.

   The request that matters most is the one the packaged desktop app sends. That
   app serves the page from `dsh-app://app` and proxies the panel's `fetch` to the
   Host itself, re-authenticating it with the Host cookie and deleting `origin`.
   A gate that demanded an Origin header answered 403 to all of them, which is
   what made clicking the chip show an empty panel; so "no Origin, loopback
   authority" is asserted to be a request that gets through, in both the
   platform-gated and the bare-fence shape. */

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

/* The `file://` URL, not a path: Windows paths are not importable specifiers. */
const pkg = await import(new URL('../lib/index.js', import.meta.url))

/* The plugin asks the Host for services through `ctx.get`, and registers into
   the host services it needs; nothing here is a stand-in for git. */
function makeHost(connection) {
  const routes = []
  const ctx = {
    webServer: {
      register(route) { routes.push(route); return () => {} },
    },
    get(name) {
      if (name === 'shell') {
        return {
          resolve: (command) => Promise.resolve(command),
          run: () => Promise.resolve({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } }),
        }
      }
      if (name === 'connection') return connection
      return undefined
    },
    effect(callback) { const dispose = callback(); return typeof dispose === 'function' ? dispose : () => {} },
    inject(_deps, callback) { return callback(ctx) },
  }
  return { ctx: ctx, routes: routes }
}

function makeRequest(headers, body) {
  const payload = Buffer.from(JSON.stringify(body === undefined ? {} : body))
  return {
    method: 'POST',
    headers: headers,
    async *[Symbol.asyncIterator]() { yield payload },
  }
}

function makeResponse() {
  return {
    statusCode: 0,
    body: '',
    writeHead(status) { this.statusCode = status },
    end(text) { this.body = text === undefined ? '' : String(text) },
  }
}

/* One registration per scenario, because the gate is captured per route. */
async function routeFor(connection) {
  const host = makeHost(connection)
  await pkg.apply(host.ctx, {})
  if (host.routes.length !== 1) throw new Error('expected one rpc route, got ' + String(host.routes.length))
  return host.routes[0]
}

/* An unregistered method answers 404 — which is the proof a request was let
   through the gate, since a refused one never reaches the dispatch. */
const THROUGH = { method: 'git/definitely-not-a-method', payload: null }

async function ask(connection, headers) {
  const route = await routeFor(connection)
  const response = makeResponse()
  await route.handler(makeRequest(headers, THROUGH), response)
  return response
}

/* The real `connection` Service: 403 for a foreign authority or a cross-site
   fetch marker, 401 without the browser session, undefined otherwise. Modelled
   here rather than imported, because the point is what the route does with each
   answer. */
const ADMITTING = { requestRejection: () => undefined }
const CROSS_SITE = { requestRejection: () => 403 }
const NO_SESSION = { requestRejection: () => 401 }

const LOOPBACK = { host: '127.0.0.1:19387' }
const DESKTOP = Object.assign({ cookie: 'dsh-auth-abc=xyz' }, LOOPBACK)
const BROWSER = Object.assign({ origin: 'http://127.0.0.1:19387' }, LOOPBACK)
const FOREIGN = Object.assign({ origin: 'http://evil.example' }, LOOPBACK)
const REBOUND = { host: 'evil.example:19387', origin: 'http://evil.example' }
const CROSS_SITE_MARKER = Object.assign({ 'sec-fetch-site': 'cross-site', origin: 'http://evil.example' }, LOOPBACK)

let passed = 0
let failed = 0
function check(label, value, extra) {
  if (value) { passed += 1; console.log('  ✓ ' + label) } else { failed += 1; console.log('  ✗ ' + label + (extra === undefined ? '' : '   ← ' + extra)) }
}

console.log('== 有 connection：平台自己那道门 ==')

const platformDesktop = await ask(ADMITTING, DESKTOP)
check('桌面端那样转过来的请求（无 origin、loopback、带 cookie）进得来',
  platformDesktop.statusCode === 404, 'status=' + platformDesktop.statusCode)

const platformBrowser = await ask(ADMITTING, BROWSER)
check('浏览器里那个同源请求也进得来',
  platformBrowser.statusCode === 404, 'status=' + platformBrowser.statusCode)

const platformCross = await ask(CROSS_SITE, CROSS_SITE_MARKER)
check('平台说 403 就是 403', platformCross.statusCode === 403, 'status=' + platformCross.statusCode)
check('403 的原话还是那句 same-origin',
  platformCross.body.indexOf('same-origin') >= 0, platformCross.body)

const platformNoSession = await ask(NO_SESSION, DESKTOP)
check('平台说 401 就是 401（没有浏览器会话）', platformNoSession.statusCode === 401, 'status=' + platformNoSession.statusCode)
check('401 说的是 authentication required',
  platformNoSession.body.indexOf('authentication required') >= 0, platformNoSession.body)

const getRoute = await routeFor(ADMITTING)
const getResponse = makeResponse()
await getRoute.handler({ method: 'GET', headers: DESKTOP }, getResponse)
check('GET 仍然是 405', getResponse.statusCode === 405, 'status=' + getResponse.statusCode)

const throwing = { requestRejection: () => { throw new Error('connection is not ready') } }
const threw = await ask(throwing, CROSS_SITE_MARKER)
check('connection 抛异常时退回围栏，跨站照样被挡', threw.statusCode === 403, 'status=' + threw.statusCode)

console.log('')
console.log('== 没有 connection：围栏自己那道门 ==')

const bareDesktop = await ask(undefined, DESKTOP)
check('无 origin 的桌面请求进得来（这是修掉的那个回归）',
  bareDesktop.statusCode === 404, 'status=' + bareDesktop.statusCode)

const bareBrowser = await ask(undefined, BROWSER)
check('同源浏览器请求进得来', bareBrowser.statusCode === 404, 'status=' + bareBrowser.statusCode)

const bareCross = await ask(undefined, CROSS_SITE_MARKER)
check('sec-fetch-site: cross-site 被挡', bareCross.statusCode === 403, 'status=' + bareCross.statusCode)

const bareForeign = await ask(undefined, FOREIGN)
check('别处的 origin 被挡', bareForeign.statusCode === 403, 'status=' + bareForeign.statusCode)

const bareRebound = await ask(undefined, REBOUND)
check('origin 的 authority 与 host 不一致就被挡',
  bareRebound.statusCode === 403, 'status=' + bareRebound.statusCode)

/* Honestly recorded, because it is the limit of the bare fence: it compares the
   two authorities rather than requiring a loopback one, exactly as the gate this
   replaced did. The loopback/trusted-authority allowlist is the platform's
   (`isTrustedApiRequest`), which is why the connection Service is asked first —
   it is present in every deployment that actually serves a page, and it is the
   one that refuses a rebound hostname. */
const bareReboundSame = await ask(undefined, { host: 'evil.example:19387', origin: 'http://evil.example:19387' })
check('围栏本身不认 loopback（改名解析那条由平台的 connection 挡）',
  bareReboundSame.statusCode === 404, 'status=' + bareReboundSame.statusCode)

const bareNoHost = await ask(undefined, { origin: 'http://127.0.0.1:19387' })
check('没有 host 头被挡', bareNoHost.statusCode === 403, 'status=' + bareNoHost.statusCode)

/* The two shapes the shipped app actually sends do not depend on which gate ran:
   the route itself must not care. */
const shipped = await ask(undefined, Object.assign({ cookie: 'dsh-auth-abc=xyz' }, LOOPBACK))
check('正式包那条路上不带 origin 也算通过（回归）', shipped.statusCode === 404, 'status=' + shipped.statusCode)

/* The published artifact is what ships; make sure the old gate is gone from it. */
const built = fs.readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8')
check('产物里不再有要求 Origin 必须存在的那道判据',
  built.indexOf('origin === undefined || host === undefined') < 0)
check('产物里问了平台的 connection.requestRejection',
  built.indexOf('connection.requestRejection') >= 0)

console.log('')
/* 不用 ✓ / ✗ 那两个字符写总结：run-all.mjs 是数它们来统计的。 */
console.log('  passed: ' + passed + '   failed: ' + failed)
process.exit(failed > 0 ? 1 : 0)
