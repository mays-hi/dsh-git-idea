    /* The section's name in the settings rail, and the page's own heading; the
       git mark in the rail hangs off this same string, so the two cannot drift
       apart. */
    const SETTINGS_NAV_LABEL = 'dsh-git-idea配置'

    function GitSettingsSection(props) {
      const settings = useGitSettings()
      const [draft, setDraft] = React.useState(settings)
      const plugin = usePluginConfig()
      const [pdraft, setPdraft] = React.useState(plugin)

      React.useEffect(function () { setDraft(settings) }, [settings])
      React.useEffect(function () { setPdraft(plugin) }, [plugin])

      const setPlugin = function (key, value) {
        const next = Object.assign({}, pdraft)
        next[key] = value
        setPdraft(next)
        savePluginConfig(next)
      }

      const apply = function (next) {
        setDraft(next)
        saveSettings(next)
      }
      const set = function (key, value) {
        const next = Object.assign({}, draft)
        next[key] = value
        apply(next)
      }
      const num = function (key, value, min, max) {
        const n = parseInt(value, 10)
        set(key, isNaN(n) ? min : n)
      }
      const watchOff = draft.watchEnabled !== true

      return h('div', {
        className: 'dsh-git-set',
        ref: function (node) {
          loadSettings(node != null ? node.ownerDocument : null)
          loadPluginConfig()
        },
      },
        h('div', { className: 'dsh-git-set-h' }, SETTINGS_NAV_LABEL),
        h('div', { className: 'dsh-git-set-hint' }, '分两层：跟随插件的配置，和只影响本浏览器的外观与节奏。'),

        h('div', { className: 'dsh-git-set-group' }, '插件配置'),
        h('div', { className: 'dsh-git-set-hint' },
          pluginConfigPath.length > 0
            ? ('保存在 ' + pluginConfigPath + ' —— 换浏览器也一致')
            : '保存在部署配置目录旁的 dsh-git-idea.json —— 换浏览器也一致'),

        h('div', { className: 'dsh-git-set-row' },
          h('span', { className: 'dsh-git-set-label' }, '初始化仓库的默认分支'),
          clearable('init', h('input', {
            className: 'dsh-git-input dsh-git-set-input',
            placeholder: 'main',
            value: pdraft.initBranch,
            onChange: function (event) { setPlugin('initBranch', event.target.value) },
          }), pdraft.initBranch.length > 0, function () { setPlugin('initBranch', '') }, 'dsh-git-clearable-set'),
          h('span', { className: 'dsh-git-set-hint' }, '引导页「在此初始化仓库」会用它执行 git init -b；留空则用 git 自己的默认值')),

        h('div', { className: 'dsh-git-set-row' },
          h('label', { className: 'dsh-git-set-check' },
            h('input', {
              type: 'checkbox', checked: pdraft.cherryPickRecord === true,
              onChange: function (event) { setPlugin('cherryPickRecord', event.target.checked) },
            }),
            h('span', null, 'cherry-pick 时记录来源（-x）'))),

        pluginConfigError.length > 0
          ? h('div', { className: 'dsh-git-set-row dsh-git-error' }, '保存失败：' + pluginConfigError)
          : null,

        h('div', { className: 'dsh-git-set-group' }, '本浏览器'),
        h('div', { className: 'dsh-git-set-hint' }, '这些只是外观和使用节奏，换浏览器各管各的。'),

        h('div', { className: 'dsh-git-set-row' },
          h('label', { className: 'dsh-git-set-check' },
            h('input', {
              type: 'checkbox', checked: draft.watchEnabled === true,
              onChange: function (event) { set('watchEnabled', event.target.checked) },
            }),
            h('span', null, '后台监测仓库变化，发现变化就自动刷新'))),

        h('div', { className: 'dsh-git-set-row' },
          h('span', { className: 'dsh-git-set-label' }, '面板打开时每'),
          h('input', {
            className: 'dsh-git-input dsh-git-set-num', type: 'number', min: 1, max: 120,
            disabled: watchOff,
            value: String(draft.watchFastSec),
            onChange: function (event) { num('watchFastSec', event.target.value, 1, 120) },
          }),
          h('span', { className: 'dsh-git-set-hint' }, '秒检查一次')),

        h('div', { className: 'dsh-git-set-row' },
          h('span', { className: 'dsh-git-set-label' }, '只有按钮时每'),
          h('input', {
            className: 'dsh-git-input dsh-git-set-num', type: 'number', min: 2, max: 600,
            disabled: watchOff,
            value: String(draft.watchSlowSec),
            onChange: function (event) { num('watchSlowSec', event.target.value, 2, 600) },
          }),
          h('span', { className: 'dsh-git-set-hint' }, '秒检查一次')),

        h('div', { className: 'dsh-git-set-row' },
          h('label', { className: 'dsh-git-set-check' },
            h('input', {
              type: 'checkbox', checked: draft.watchChip === true, disabled: watchOff,
              onChange: function (event) { set('watchChip', event.target.checked) },
            }),
            h('span', null, '面板关着时也监测，让按钮上的分支名和改动数保持实时'))),

        h('div', { className: 'dsh-git-set-row' },
          h('label', { className: 'dsh-git-set-check' },
            h('input', {
              type: 'checkbox', checked: draft.hoverSwitch === true,
              onChange: function (event) { set('hoverSwitch', event.target.checked) },
            }),
            h('span', null, '鼠标停在输入框旁的 Git 按钮上，弹出分支切换卡片（点一下就切）'))),

        h('div', { className: 'dsh-git-set-row' },
          h('span', { className: 'dsh-git-set-label' }, '面板尺寸'),
          h('span', { className: 'dsh-git-set-hint' },
            panelSize.w > 0 || panelSize.h > 0
              ? (String(panelSize.w) + ' × ' + String(panelSize.h) + ' 像素')
              : '跟随输入框宽度 / 74vh'),
          h('button', {
            type: 'button', className: 'dsh-git-btn',
            onClick: function () { publishPanelSize({ w: 0, h: 0 }); savePanelSize() },
          }, '恢复默认尺寸')),

        h('div', { className: 'dsh-git-set-row' },
          h('span', { className: 'dsh-git-set-label' }, '切换器的记忆'),
          h('span', { className: 'dsh-git-set-hint' }, '最近使用与收藏只写在这个浏览器里'),
          h('button', {
            type: 'button', className: 'dsh-git-btn',
            onClick: function () { clearBranchMemory() },
          }, '清除最近使用与收藏')),

        h('div', { className: 'dsh-git-set-row' },
          h('button', {
            type: 'button', className: 'dsh-git-btn',
            onClick: function () { apply(Object.assign({}, SETTINGS_DEFAULTS)) },
          }, '本浏览器全部恢复默认')))
    }

