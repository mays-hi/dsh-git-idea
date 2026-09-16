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
    let settingsDoc = null
    const settingsListeners = new Set()

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

    function adoptSettingsDoc(doc) {
      if (doc != null && settingsDoc == null) settingsDoc = doc
      migrateStore(doc)
      if (settingsLoaded) return
      settingsLoaded = true
      try {
        const store = panelStore(doc)
        if (store == null) return
        gitSettings = normalizeSettings(JSON.parse(store.getItem(SETTINGS_KEY) || 'null'))
      } catch (error) {
        gitSettings = Object.assign({}, SETTINGS_DEFAULTS)
      }
    }

    function saveSettings(next) {
      gitSettings = normalizeSettings(next)
      try {
        const store = panelStore(settingsDoc)
        if (store != null) store.setItem(SETTINGS_KEY, JSON.stringify(gitSettings))
      } catch (error) {
        /* a refused preference is not worth breaking the panel over */
      }
      settingsListeners.forEach(function (listener) { listener() })
      rescheduleWatchers()
    }

    function useGitSettings() {
      const pair = React.useState(gitSettings)
      React.useEffect(function () {
        const listener = function () { pair[1](gitSettings) }
        settingsListeners.add(listener)
        return function () { settingsListeners.delete(listener) }
      }, [])
      return pair[0]
    }

    /* ── preferences, layer two: the plugin ──

       Kept apart from the browser-local half above, because these are properties
       of the plugin and not of whoever is looking at it: which branch a new
       repository starts on, and whether cherry-pick records its origin. They
       live in a file beside the deployment's own settings, owned by the Host
       half, so they travel across browsers and machines. As an ordinary plugin
       this is exactly what its config section would hold. */

    let pluginConfig = { initBranch: 'main', cherryPickRecord: false }
    let pluginConfigPath = ''
    let pluginConfigLoaded = false
    let pluginConfigError = ''
    const pluginConfigListeners = new Set()

    function normalizePluginConfig(raw) {
      const out = { initBranch: 'main', cherryPickRecord: false }
      if (raw == null || typeof raw !== 'object') return out
      if (typeof raw.initBranch === 'string') out.initBranch = raw.initBranch.trim().slice(0, 120)
      out.cherryPickRecord = raw.cherryPickRecord === true
      return out
    }

    function announcePluginConfig() {
      pluginConfigListeners.forEach(function (listener) { listener() })
    }

    function adoptPluginConfig(data) {
      if (data == null) { announcePluginConfig(); return }
      if (typeof data.path === 'string') pluginConfigPath = data.path
      if (data.config !== undefined) pluginConfig = normalizePluginConfig(data.config)
      pluginConfigError = ''
      announcePluginConfig()
    }

    function loadPluginConfig() {
      if (pluginConfigLoaded) return
      pluginConfigLoaded = true
      host.call('git/config', {}).then(adoptPluginConfig).catch(function (failure) {
        pluginConfigError = String(failure != null && failure.message !== undefined ? failure.message : failure)
        announcePluginConfig()
      })
    }

    function savePluginConfig(next) {
      pluginConfig = normalizePluginConfig(next)
      pluginConfigError = ''
      announcePluginConfig()
      host.call('git/config-save', { config: pluginConfig }).then(function (result) {
        if (result == null || result.ok !== true) {
          pluginConfigError = text(result != null ? result.error : '') || '保存失败'
          announcePluginConfig()
          return
        }
        adoptPluginConfig(result)
      }).catch(function (failure) {
        pluginConfigError = String(failure != null && failure.message !== undefined ? failure.message : failure)
        announcePluginConfig()
      })
    }

    function usePluginConfig() {
      const pair = React.useState(pluginConfig)
      React.useEffect(function () {
        const listener = function () { pair[1](pluginConfig) }
        pluginConfigListeners.add(listener)
        return function () { pluginConfigListeners.delete(listener) }
      }, [])
      return pair[0]
    }

