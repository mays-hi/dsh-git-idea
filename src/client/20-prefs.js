    /* ── preferences, layer one: this browser ──

       Appearance and cadence only. Anything that describes what Git should DO
       lives in layer two below, because it is a property of the plugin rather
       than of whoever is looking at it. The harness Host does expose a
       `settings` service, but registering a namespace there needs a schemastery
       schema and a dynamic Host half gets no schemastery; the slot contract for
       a contributed settings entry also says outright that copy, current value
       and write path belong to the contributor. */

    const SETTINGS_KEY = 'dsh.git-idea.settings'
    const SETTINGS_DEFAULTS = {
      watchEnabled: true,
      watchChip: true,
      watchFastSec: 3,
      watchSlowSec: 15,
      hoverSwitch: true,
    }
    let gitSettings = Object.assign({}, SETTINGS_DEFAULTS)
    let settingsLoaded = false
    const settingsSignal = createSignal(function () { return gitSettings })
    const useGitSettings = settingsSignal.use

    function clampInt(value, min, max, fallback) {
      const n = typeof value === 'number' && isFinite(value) ? Math.round(value) : NaN
      if (isNaN(n)) return fallback
      if (n < min) return min
      if (n > max) return max
      return n
    }

    function normalizeSettings(raw) {
      const out = Object.assign({}, SETTINGS_DEFAULTS)
      if (raw == null || typeof raw !== 'object') return out
      out.watchEnabled = raw.watchEnabled !== false
      out.watchChip = raw.watchChip !== false
      out.watchFastSec = clampInt(raw.watchFastSec, 1, 120, SETTINGS_DEFAULTS.watchFastSec)
      out.watchSlowSec = clampInt(raw.watchSlowSec, 2, 600, SETTINGS_DEFAULTS.watchSlowSec)
      out.hoverSwitch = raw.hoverSwitch !== false
      if (out.watchSlowSec < out.watchFastSec) out.watchSlowSec = out.watchFastSec
      return out
    }

    /* Called by every surface that has just been handed a document, so a later
       save finds a store even if the surface that changed something is gone. */
    function loadSettings(doc) {
      localStore(doc)
      if (settingsLoaded) return
      settingsLoaded = true
      gitSettings = normalizeSettings(readStoredJSON(SETTINGS_KEY, null))
    }

    function saveSettings(next) {
      gitSettings = normalizeSettings(next)
      writeStoredJSON(SETTINGS_KEY, gitSettings)
      settingsSignal.notify()
      rescheduleWatchers()
    }

    /* ── preferences, layer two: the plugin ──

       Kept apart from the browser-local half above, because these are properties
       of the plugin and not of whoever is looking at it: which branch a new
       repository starts on, and whether cherry-pick records its origin. They
       live in a file beside the deployment's own settings, owned by the Host
       half, so they travel across browsers and machines. As an ordinary plugin
       this is exactly what its config section would hold. */

    const PLUGIN_CONFIG_DEFAULTS = { initBranch: 'main', cherryPickRecord: false }
    let pluginConfig = Object.assign({}, PLUGIN_CONFIG_DEFAULTS)
    let pluginConfigPath = ''
    let pluginConfigLoaded = false
    let pluginConfigError = ''
    const pluginConfigSignal = createSignal(function () { return pluginConfig })
    const usePluginConfig = pluginConfigSignal.use

    function normalizePluginConfig(raw) {
      const out = Object.assign({}, PLUGIN_CONFIG_DEFAULTS)
      if (raw == null || typeof raw !== 'object') return out
      if (typeof raw.initBranch === 'string') out.initBranch = raw.initBranch.trim().slice(0, 120)
      out.cherryPickRecord = raw.cherryPickRecord === true
      return out
    }

    function adoptPluginConfig(data) {
      if (data != null) {
        if (typeof data.path === 'string') pluginConfigPath = data.path
        if (data.config !== undefined) pluginConfig = normalizePluginConfig(data.config)
        pluginConfigError = ''
      }
      pluginConfigSignal.notify()
    }

    function loadPluginConfig() {
      if (pluginConfigLoaded) return
      pluginConfigLoaded = true
      callHost('git/config', {}).then(adoptPluginConfig).catch(function (failure) {
        pluginConfigError = failureText(failure)
        pluginConfigSignal.notify()
      })
    }

    /* What is on screen is the draft and updates at once; the file follows when
       the typing stops. Every keystroke of a branch name used to be its own RPC
       and its own write of the config file, and the settings page asks for one on
       each `onChange`. */
    const CONFIG_SAVE_MS = 400
    let configSaveTimer = null

    function writePluginConfig() {
      callHost('git/config-save', { config: pluginConfig }).then(function (result) {
        if (result == null || result.ok !== true) {
          pluginConfigError = text(result != null ? result.error : '') || '保存失败'
          pluginConfigSignal.notify()
          return
        }
        adoptPluginConfig(result)
      }).catch(function (failure) {
        pluginConfigError = failureText(failure)
        pluginConfigSignal.notify()
      })
    }

    function savePluginConfig(next) {
      pluginConfig = normalizePluginConfig(next)
      pluginConfigError = ''
      pluginConfigSignal.notify()
      if (configSaveTimer != null) { configSaveTimer(); configSaveTimer = null }
      const timer = ctx.get('timer')
      if (timer === undefined) { writePluginConfig(); return }
      configSaveTimer = timer.timeout(function () {
        configSaveTimer = null
        writePluginConfig()
      }, CONFIG_SAVE_MS)
    }
