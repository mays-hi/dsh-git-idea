/* ── the real-package Client half ──

   A classic script, because that is what \`dsh-client-modules\` evaluates: a
   \`__ModuleLoader__\` bundle, no import/export. The fragments under src/client/
   were written for the dynamic bridge, which gave the browser realm \`React\` as
   a closure symbol and \`host.call(method, payload)\` as its one door to the
   Host. This prelude binds React from the module table and implements that same
   door over the route host-pre.js mounts — one body, two builds. */
window.__ModuleLoader__.load({
  id: 'dsh-git-idea',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')

    const RPC_PATH = '/dsh-git-idea/rpc'

    /* A method name and a JSON payload in, the handler's JSON answer out. The
       Host answers 404 for a method it has not registered yet, which is the
       exact case 10-state.js retries — so the message has to keep saying
       "is not registered". */
    const host = {
      call: function (method, payload) {
        return fetch(RPC_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: method, payload: payload === undefined ? null : payload }),
        }).then(function (response) {
          return response.text().then(function (text) {
            let data = null
            try {
              data = text.length > 0 ? JSON.parse(text) : null
            } catch (error) {
              data = null
            }
            if (response.status === 404) throw new Error(method + ' is not registered')
            if (data === null || data.ok !== true) {
              const message = data !== null && typeof data.error === 'string'
                ? data.error
                : 'host.call failed with HTTP ' + String(response.status)
              throw new Error(message)
            }
            return data.value
          })
        })
      },
    }

    /* The dynamic bridge's browser realm also handed the fragments a `styles`
       symbol, and 46-css.js is written against it: one `insert(text)` that
       appends a <style> element and returns the remover that `ctx.effect`
       disposes with. The real client realm has no such symbol —
       `dsh-client-modules` instead claims whatever <style> a factory injected
       and tags it for HMR — so the prelude supplies the same one over the same
       DOM. */
    const styles = {
      insert: function (text) {
        const element = document.createElement('style')
        element.textContent = text
        document.head.appendChild(element)
        return function () {
          if (element.parentNode !== null) element.parentNode.removeChild(element)
        }
      },
    }

    const plugin = (function () {
