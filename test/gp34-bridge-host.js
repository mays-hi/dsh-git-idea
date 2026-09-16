return {
  apply(ctx) {
    /* ── the source bridge, not the plugin itself ──

       The real Host half sits in a file beside the deployment's own settings
       (<DSH_HOME>/dsh-git-idea/host.js) and is evaluated here.

       Two facts put it there. A dynamic Package is immutable, so every change
       means submitting the whole thing again through the model — and this
       plugin is now well past the size where that is a copy rather than a
       regeneration, which risks silent drift in code nobody re-reads. And the
       deployment already has a mechanism for a plugin that lives in files: a
       real package ships its Host half as lib/ and its Client half as
       client/client.js. This bridge is that layout, loaded by hand, until the
       plugin moves into a profile bundle.

       Everything the evaluated source registers — tools, RPC handlers, effects
       — belongs to this fiber, so stop, update and undefine still remove all of
       it. Re-running this Package re-reads the file, which is how a change to
       the source is picked up. */

    const shell = ctx.get('shell')
    const fsService = ctx.get('fs')

    function quote(value) {
      return "'" + String(value).replace(/'/g, "'\\''") + "'"
    }

    async function probe(command) {
      if (shell === undefined) return null
      return await shell.run(shell.resolve({ command: command, timeoutMs: 20000, stdoutMaxBytes: 8388608 }))
    }

    async function probeText(command) {
      const raw = await probe(command)
      if (raw == null || raw.exitCode !== 0 || raw.stdout == null) return ''
      return typeof raw.stdout.text === 'string' ? raw.stdout.text : ''
    }

    let dirsCache = null
    async function sourceDirs() {
      if (dirsCache !== null) return dirsCache
      dirsCache = []
      const home = (await probeText('printf %s "${DSH_HOME:-$HOME/.dsh}"')).trim()
      if (home.length > 0) {
        dirsCache.push(home + '/dsh-git-idea')
        /* The plugin was called gitops until it was renamed; the old directory
           is still tried so the rename can never leave a half-moved
           installation that refuses to load. */
        dirsCache.push(home + '/gitops')
      }
      return dirsCache
    }

    async function readOne(path) {
      if (fsService !== undefined) {
        try {
          const target = await fsService.resolve(path)
          const text = await fsService.readText(target)
          if (typeof text === 'string' && text.length > 0) return text
        } catch (error) {
          /* fall through to the shell reader below */
        }
      }
      return await probeText('cat ' + quote(path))
    }

    async function readSource(name) {
      const dirs = await sourceDirs()
      for (let i = 0; i < dirs.length; i += 1) {
        const text = await readOne(dirs[i] + '/' + name)
        if (text.length > 0) return text
      }
      throw new Error('cannot read ' + name + (dirs.length > 0 ? ' from ' + dirs.join(' or ') : ''))
    }

    /* The Client half is fetched from here, because the Client realm has no
       filesystem of its own. */
    ctx.effect(function () {
      return harness.handle('dsh-git-idea/source', async function (input) {
        const name = input != null && input.half === 'client' ? 'client.js' : 'host.js'
        const source = await readSource(name)
        return { ok: true, half: name, source: source }
      })
    }, 'gitops bridge source rpc')

    ctx.effect(function () {
      const loading = (async function () {
        const source = await readSource('host.js')
        const factory = new Function('ctx', 'harness', 'console', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', source)
        const plugin = factory(ctx, harness, console, btoa, atob, TextEncoder, TextDecoder)
        if (plugin == null || typeof plugin.apply !== 'function') throw new Error('the Host source did not return a plugin')
        plugin.apply(ctx)
        console.log('dsh-git-idea bridge: loaded ' + String(source.length) + ' bytes of Host source')
      })()
      loading.catch(function (error) {
        const detail = error != null && error.message !== undefined ? String(error.message) : String(error)
        console.error('dsh-git-idea bridge: ' + detail)
      })
      return function () {}
    }, 'dsh-git-idea bridge host')
  },
}
