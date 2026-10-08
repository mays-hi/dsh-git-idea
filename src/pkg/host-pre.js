/* ── the real-package Host half ──

   The fragments under src/host/ were written for the dynamic Cordis bridge:
   that realm handed the plugin a \`harness\` and a façade \`ctx\`. A real package
   gets neither, so this prelude supplies the one thing the body still asks of a
   harness — \`handle\`, which the RPC route below serves. (It used to supply
   \`defineTool\` / \`registerTool\` too, for the model tools; the plugin ships
   none, see the README's 「不注册工具」.) The body after it is the same text the
   dynamic bridge loads — one body, two builds — and host-post.js exports the
   plugin object. */

/* 10-shell.js 在 Windows 上要用它找一个 POSIX shell（见那里的注释）。这一侧是 ESM，
   所以它在这里；动态桥那一侧没有这个绑定，那边的代码用 \`typeof fs\` 守住。 */
import fs from 'node:fs'

/* The one route the browser half calls: same origin as the page, so no CORS. */
const RPC_PATH = '/dsh-git-idea/rpc'
const RPC_MAX_BYTES = 1048576

/* Every handler the Client registered through \`harness.handle\`, keyed by the
   method string it passed to \`host.call\`. */
const rpcHandlers = new Map()

function detail(error) {
  return error != null && error.message !== undefined ? String(error.message) : String(error)
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > RPC_MAX_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text.length === 0 ? null : JSON.parse(text)
}

/* ── who may drive git ──

   This route runs git in the reader's own working directory, on a port any page
   on this machine can reach, so every POST needs a gate. The platform already
   owns that decision: \`connection.requestRejection\` applies the deployment's
   Host/Origin fence — the authority must be loopback or one this deployment
   trusts, and a cross-site fetch marker is refused — and then requires the
   browser session the Host handed out. That is the same gate the shipped
   \`dsh-host-open-in-app\` puts in front of its own routes, because \`webServer\`
   itself adds none.

   Asking the platform is also what makes the packaged desktop app work. That app
   serves the page from \`dsh-app://app\`, so the panel's \`fetch\` is forwarded to
   this Host by the Electron main process, which re-authenticates the request with
   the Host cookie and then **deletes \`origin\`** (and \`sec-fetch-site\`). The gate
   this file used to keep — "an Origin header must be present and equal to Host" —
   therefore refused every single request the desktop made: \`git/panel\` answered
   403, the panel had no reading to draw, and clicking the chip showed an empty
   panel that never filled in.

   Without a connection Service the fence is spelled here, the way the platform
   spells it: a missing Origin is ordinary rather than suspicious (the desktop
   proxy removes it, and a same-origin POST need not carry one), a present Origin
   has to match the authority, and a cross-site fetch marker is refused. */
function fenceRejection(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') return 403
  const host = request.headers.host
  if (typeof host !== 'string' || host.length === 0) return 403
  const origin = request.headers.origin
  if (origin === undefined) return undefined
  try {
    return new URL(origin).host === new URL('http://' + host).host ? undefined : 403
  } catch (error) {
    return 403
  }
}

/* The platform's answer when there is one. A connection Service that throws is
   not a licence to run git: the fence still refuses a foreign page, which is the
   thing this gate exists for. */
function gateRejection(request, connection) {
  if (connection !== undefined && connection !== null && typeof connection.requestRejection === 'function') {
    try {
      return connection.requestRejection(request)
    } catch (error) {
      return fenceRejection(request)
    }
  }
  return fenceRejection(request)
}

/* The dynamic bridge refused an unregistered method with "... is not
   registered", and 10-state.js retries exactly that sentence while the Host
   half is still coming up. The 404 below keeps the same words, so that retry
   survives the move to a real package. */
async function rpcRoute(request, response, connection) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'rpc is POST only' })
    return
  }
  const refusal = gateRejection(request, connection)
  if (refusal !== undefined) {
    sendJson(response, refusal, {
      ok: false,
      error: refusal === 401 ? 'authentication required' : 'same-origin requests only',
    })
    return
  }
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    sendJson(response, 400, { ok: false, error: detail(error) })
    return
  }
  const method = body != null && typeof body.method === 'string' ? body.method : ''
  const handler = rpcHandlers.get(method)
  if (handler === undefined) {
    sendJson(response, 404, { ok: false, error: method + ' is not registered' })
    return
  }
  try {
    const value = await handler(body.payload)
    sendJson(response, 200, { ok: true, value: value === undefined ? null : value })
  } catch (error) {
    sendJson(response, 200, { ok: false, error: detail(error) })
  }
}

/* The body registers RPC handlers here and nothing else: with no model tools
   there is no tool registry to reach, and \`inject\` no longer names one. */
const harness = {
  handle: function (method, handler) {
    rpcHandlers.set(method, handler)
    return function () { rpcHandlers.delete(method) }
  },
}

export const name = 'dsh-git-idea'

const plugin = (function () {
