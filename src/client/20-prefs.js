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
      /* 面板关着时 chip 那条慢 lane。它现在只发一次便宜签名（真机上 0.12s），所以可以
         问得比过去勤：15s 的话，终端里提交完要过十几秒 chip 才改口。 */
      watchSlowSec: 5,
      hoverSwitch: true,
      /* Which of the two changes views the panel opens in: the directory tree
         (IDEA's default) or the flat list of paths. A preference of this browser
         rather than of the plugin — it is about how someone reads a diff, not
         about what git should do. */
      changesView: 'tree',
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
      out.changesView = raw.changesView === 'flat' ? 'flat' : 'tree'
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
      /* 读到了也要说一声：挂载前就订阅了的界面（先开面板、后开设置页）靠这条更新。 */
      settingsSignal.notify()
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

    /* 这份名单只负责**第一帧**：Host 还没答复时页面上该有什么值。schema 本身归
       Host（70-config.js 的 `normalizeConfig`）—— 下面那个归一化函数故意不做白名单，
       理由写在它自己那段注释里。 */
    const PLUGIN_CONFIG_DEFAULTS = {
      initBranch: 'main', cherryPickRecord: false,
      /* 空 = 用部署 PATH 里的 git。 */
      gitPath: '',
      /* 这三条是插件自己给 git 的实参，不是 git 设置的副本。 */
      fetchPrune: true, pullRebase: false, pushSetUpstream: false,
      /* 工作区里找仓库往下几层：0 是「不找」（见 69-repos.js）。 */
      repoScanDepth: 2,
    }
    let pluginConfig = Object.assign({}, PLUGIN_CONFIG_DEFAULTS)
    let pluginConfigPath = ''
    let pluginConfigLoaded = false
    let pluginConfigError = ''
    const pluginConfigSignal = createSignal(function () { return pluginConfig })
    const usePluginConfig = pluginConfigSignal.use

    /* 每次**Host 确认过**的配置计数。屏幕上那份草稿是即时的（`savePluginConfig` 当场
       改内存，400ms 后才落盘），所以「问 Host 一件事」不能挂在草稿上：挂上去的话每敲
       一个键都是一次询问，而且问到的是 Host 手里那份还没更新的配置 —— 真机上量到的
       是界面永远慢一步。这个计数只在答复带着配置回来时才动（初次读取、保存成功）。 */
    let pluginConfigCommitted = 0
    const pluginConfigCommittedSignal = createSignal(function () { return pluginConfigCommitted })
    const usePluginConfigCommitted = pluginConfigCommittedSignal.use

    /* ── 合并，不是过滤 ──

       认得的键照旧归整类型，**不认识的键原样带走**。以前这里是一张白名单，代价是
       一次真事故：`repoScanDepth` 没写进上面那份名单，于是设置页里那个下拉框永远
       显示默认的 2（Host 明明答了 3），而且读者改**任何**一个别的插件设置，400ms 后
       落盘的那一份都会把它抹掉 —— Host 收到一份没有这个键的配置，只能按默认值写。

       schema 只有一个主人（Host 的 `normalizeConfig`：它做白名单，也做钳位）。这边
       多做一次白名单，就是第二个主人，也就会有第二次这样的漂移。 */
    function normalizePluginConfig(raw) {
      const out = Object.assign({}, PLUGIN_CONFIG_DEFAULTS, raw != null && typeof raw === 'object' ? raw : {})
      if (typeof out.initBranch !== 'string') out.initBranch = PLUGIN_CONFIG_DEFAULTS.initBranch
      out.initBranch = out.initBranch.trim().slice(0, 120)
      out.cherryPickRecord = out.cherryPickRecord === true
      if (typeof out.gitPath !== 'string') out.gitPath = PLUGIN_CONFIG_DEFAULTS.gitPath
      out.gitPath = out.gitPath.trim().slice(0, 400)
      out.fetchPrune = out.fetchPrune !== false
      out.pullRebase = out.pullRebase === true
      out.pushSetUpstream = out.pushSetUpstream === true
      out.repoScanDepth = typeof out.repoScanDepth === 'number' && isFinite(out.repoScanDepth)
        ? out.repoScanDepth
        : PLUGIN_CONFIG_DEFAULTS.repoScanDepth
      return out
    }

    function adoptPluginConfig(data) {
      if (data != null) {
        if (typeof data.path === 'string') pluginConfigPath = data.path
        if (data.config !== undefined) pluginConfig = normalizePluginConfig(data.config)
        pluginConfigError = ''
      }
      pluginConfigCommitted += 1
      pluginConfigSignal.notify()
      pluginConfigCommittedSignal.notify()
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
      const request = { config: pluginConfig }
      /* 写在部署的配置目录里，也就是任何工作区之外：带上这个页面在哪个会话里，Host
         才能用这个会话的沙箱策略去写（没有会话时写不出去，而那种失败必须说得出来）。 */
      if (lastSessionId.length > 0) request.sessionId = lastSessionId
      callHost('git/config-save', request).then(function (result) {
        if (result == null || result.ok !== true) {
          /* git 那套「这台机器 / 这个沙箱不让我做这件事」的说法是同一份（见
             commandDetail）：这里也走它，免得写不进去时屏幕上什么都没有。 */
          pluginConfigError = commandDetail(result) || text(result != null ? result.error : '') || '保存失败'
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
