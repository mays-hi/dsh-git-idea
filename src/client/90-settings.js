    /* The section's name in the settings rail, and the page's own heading. The
       rail's glyph for it stays the shell's gear: the registration contract is
       id/order/label with no icon field, and swapping a glyph the shell owns
       would be a workaround around its own tree, not a feature. */
    const SETTINGS_NAV_LABEL = 'dsh-git-idea配置'

    /* ── 设置页的三块积木 ──

       一张卡片 = 一件事（插件配置 / 远程同步 / git 位置 / 提交身份 / 本浏览器），
       卡片里每一行是**同一个两列网格**：左列名字，右列控件，控件自己的说明跟在控件
       下面（还在右列里）。

       以前每一行是「flex + 可换行 + 170px 的标签」：说明文字一换行就落回行首，于是
       控件在 260px、说明却从 40px 开始 —— 整页的左边缘是锯齿形的。现在说明留在右列，
       所有控件共用同一条竖线。布尔行也走同一个网格（勾选框占右列），所以「勾选框在
       最左边、输入框在中间」那种两套左边距也没有了。 */
    function setCard(title, desc, children) {
      const body = []
      for (let i = 0; i < children.length; i += 1) if (children[i] != null) body.push(children[i])
      return h('section', { className: 'dsh-git-set-card' },
        h('div', { className: 'dsh-git-set-card-h' }, title),
        desc.length > 0 ? h('div', { className: 'dsh-git-set-card-d' }, desc) : null,
        body.length > 0 ? h('div', { className: 'dsh-git-set-card-b' }, body) : null)
    }

    function setRow(label, control, hint) {
      return h('div', { className: 'dsh-git-set-row' },
        h('span', { className: 'dsh-git-set-label' }, label),
        h('div', { className: 'dsh-git-set-ctl' },
          control,
          hint != null && hint.length > 0 ? h('div', { className: 'dsh-git-set-hint' }, hint) : null))
    }

    /* 一行布尔：勾选框和它的说明都落在右列，和上面那些输入框同一条竖线。 */
    function setCheck(checked, disabled, onChange, label, hint) {
      return h('div', { className: 'dsh-git-set-row' },
        h('span', { className: 'dsh-git-set-label' }, ''),
        h('div', { className: 'dsh-git-set-ctl' },
          h('label', { className: 'dsh-git-set-check' },
            h('input', { type: 'checkbox', checked: checked, disabled: disabled === true, onChange: onChange }),
            h('span', null, label)),
          hint != null && hint.length > 0 ? h('div', { className: 'dsh-git-set-hint' }, hint) : null))
    }

    /* 整行只有一句话的行（写入结果、失败原因）。名字不叫 setNote：提交身份那一组里
       有个同名的 state setter，组件内会被它遮住（第一版就是这么丢的）。 */
    function noteRow(text, extra) {
      return h('div', { className: 'dsh-git-set-row' },
        h('span', { className: 'dsh-git-set-label' }, ''),
        h('div', { className: 'dsh-git-set-ctl' },
          h('div', { className: extra === undefined ? 'dsh-git-set-hint' : extra }, text)))
    }

    /* 控件 + 一小段跟在旁边的字（「秒检查一次」、按钮 + 说明）。 */
    function setInline(children) {
      return h('div', { className: 'dsh-git-set-inline' }, children)
    }

    /* ── 提交身份：写在 git 自己的配置里 ──

       这一组和上面那个插件配置文件不是一回事：`user.name` / `user.email` 是 git 的
       设置，写进去以后终端里的 git、IDEA、钩子看到的都是同一个作者。所以这里既读又
       写，而且写什么由读者挑：这台机器的所有仓库（`--global`），还是只这一个仓库
       （`--local`）。

       面板不替你署名：空着的框一个字节都不写（`git config user.name ''` 正是「empty
       ident name」那个错误的来路），两个都空就什么也不做并说清楚。 */
    function GitIdentityGroup() {
      const sessionId = useLastSession()
      const [state, setState] = React.useState(null)
      const [name, setName] = React.useState('')
      const [email, setEmail] = React.useState('')
      const [scope, setScope] = React.useState('global')
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [problem, setProblem] = React.useState('')

      /* 只把 session id 交给 Host，路径由它自己从会话的工作区解出来 —— 和面板、
         chip 走的是同一条路，也就落在这个会话的沙箱策略里。 */
      const request = function () {
        return sessionId.length > 0 ? { sessionId: sessionId } : {}
      }
      const load = function () {
        callHost('git/identity', request()).then(function (data) {
          setState(data)
          setProblem('')
          /* 预填：先给此刻生效的那一份，没有再给机器上的那一份。读者要改的就是它。 */
          const effectiveName = text(data.name)
          const effectiveEmail = text(data.email)
          setName(effectiveName.length > 0 ? effectiveName : text(data.globalName))
          setEmail(effectiveEmail.length > 0 ? effectiveEmail : text(data.globalEmail))
        }, function (failure) { setProblem(failureText(failure)) })
      }
      React.useEffect(function () { load() }, [sessionId])

      const save = function () {
        if (busy) return
        setBusy(true)
        setNote('')
        setProblem('')
        const payload = { scope: scope, name: name, email: email }
        if (sessionId.length > 0) payload.sessionId = sessionId
        callHost('git/identity-save', payload).then(function (result) {
          setBusy(false)
          setState(result)
          setNote(result.scope === 'local'
            ? ('已写进 ' + text(result.repo) + ' 的 .git/config：' + result.written.join('、'))
            : ('已写进这台机器的 git 配置：' + result.written.join('、')))
        }, function (failure) {
          setBusy(false)
          setProblem(failureText(failure))
        })
      }

      const ready = state != null
      const missing = ready && state.needsIdentity === true
      const source = function (value, origin) {
        const one = text(value)
        if (one.length === 0) return '没有配'
        const from = text(origin)
        return from.length === 0 ? one : (one + '（来自 ' + from + '）')
      }
      /* 两个范围合成一行：它们是同一个问题的两个答案（写进哪里），分两行时右列会空一格。 */
      const toggle = function (next) {
        return h('label', { className: 'dsh-git-set-check' },
          h('input', {
            type: 'radio', checked: scope === next, name: 'dsh-git-ident-scope',
            onChange: function () { setScope(next) },
          }),
          h('span', null, next === 'global' ? '这台机器的所有仓库（--global）' : '只对这个仓库（--local）'))
      }
      const repo = text(state != null ? state.repo : '')

      return setCard('提交身份', '写在 git 自己的配置里：终端里的 git、IDEA、钩子看到的是同一份。空着的框一个字节都不写。', [
        setRow('此刻生效',
          h('span', { className: missing === true ? 'dsh-git-set-hint dsh-git-warn' : 'dsh-git-set-hint' },
            ready !== true ? '正在读取…'
              : (missing === true
                /* 两半都缺时说两半。Host 一直带着 `emailMissing`，只是这里没读 —— 于是
                   名字和邮箱都没配的人先被告知"还缺：名字"，填完再被告知"还缺：邮箱"，
                   两趟才走完一件本来一趟就能说清的事。 */
                ? '还缺：' + (state.nameMissing === true && state.emailMissing === true
                  ? '名字和邮箱'
                  : (state.nameMissing === true ? '名字' : '邮箱')) + ' —— 提交会被 git 拒绝'
                : (source(state.name, state.nameOrigin) + ' · ' + source(state.email, state.emailOrigin))))),

        setRow('名字', h('input', {
          className: 'dsh-git-input dsh-git-set-input',
          placeholder: '提交里显示的名字',
          value: name,
          onChange: function (event) { setName(event.target.value) },
        })),

        setRow('邮箱', h('input', {
          className: 'dsh-git-input dsh-git-set-input',
          placeholder: 'you@example.com',
          value: email,
          onChange: function (event) { setEmail(event.target.value) },
        })),

        setRow('写进哪里',
          h('div', { className: 'dsh-git-set-stack' }, [toggle('global'), toggle('local')]),
          repo.length > 0
            ? ('这个仓库 = ' + repo)
            : '这个页面还不知道是哪个会话的仓库 —— 先打开一次面板（或输入框旁的 Git 按钮），或只写全局那一份'),

        setRow('',
          setInline([h('button', {
            type: 'button', className: 'dsh-git-btn dsh-git-primary',
            disabled: busy || (scope === 'local' && repo.length === 0),
            onClick: save,
          }, busy ? '写入中…' : '写入 git 配置')]),
          '写进去就是以后所有提交的作者，别的工具也看得到'),

        note.length > 0 ? noteRow(note) : null,
        problem.length > 0 ? noteRow(problem, 'dsh-git-error') : null,
      ])
    }

    /* ── git 位置：这台机器上的哪个 git ──

       每一行命令都以同一个词开头，而那个词默认来自部署的 PATH。装在不在这条 PATH 上的
       地方（Homebrew 前缀、IDE 自带的 git、nix profile）时，面板以前只会说「这台机器
       上找不到 git」—— 既是错的，也没给出下一步。所以它是个设置。 */
    function GitToolchainGroup() {
      const plugin = usePluginConfig()
      const committed = usePluginConfigCommitted()
      const [draftPath, setDraftPath] = React.useState(plugin.gitPath)
      const [tool, setTool] = React.useState(null)
      React.useEffect(function () { setDraftPath(plugin.gitPath) }, [plugin.gitPath])

      const probe = function () {
        callHost('git/toolchain', {}).then(function (data) { setTool(data) }, function (failure) {
          setTool({ ok: false, path: '', version: '', found: false, reason: 'probe-failed', error: failureText(failure) })
        })
      }
      /* 问的时机是**Host 确认过之后**，不是敲键的时候：草稿是即时的，而
         `savePluginConfig` 有 400ms 去抖，落盘之后 Host 才回话。挂在草稿上问，
         问到的是上一份配置 —— 真机上量到的就是界面永远慢一步（写入坏路径之后那一行
         还说「来自 PATH」，要等下一次改动才改口）；挂在每次按键上还会把一次询问变成
         每个字符一次。`committed` 只在答复带着配置回来时动。 */
      React.useEffect(function () { probe() }, [committed])

      const commitPath = function (value) {
        setDraftPath(value)
        const next = Object.assign({}, plugin)
        next.gitPath = value
        savePluginConfig(next)
      }
      const found = tool != null && tool.found === true
      const reason = tool == null ? '' : text(tool.reason)
      const verdict = tool == null
        ? '正在检查…'
        : (found
          ? ('现在用的是 ' + tool.path + (tool.fromPath === true ? '（来自 PATH）' : '（设置里写的就是它）')
            + ' · ' + text(tool.version))
          : (reason === 'configured-missing'
            ? '设置里写的这个路径不可用：它不存在，或者不是可执行文件。面板里的每条命令都会失败。'
            : '这台机器的 PATH 上没有 git。装上它，或者在下面写一个绝对路径。'))

      return setCard('git 位置', '面板的每一条命令都以这一个词开头；它装在 PATH 之外时（Homebrew 前缀、IDE 自带的 git、nix profile）写绝对路径。', [
        setRow('可执行文件', h('input', {
          className: 'dsh-git-input dsh-git-set-input dsh-git-set-input-wide',
          placeholder: '留空 = 用 PATH 里的 git',
          value: draftPath,
          onChange: function (event) { commitPath(event.target.value) },
        })),

        setRow('', h('span', { className: found === true ? 'dsh-git-set-hint' : 'dsh-git-set-hint dsh-git-warn' }, verdict)),

        shellRow(tool),

        setRow('', setInline([
          h('button', { type: 'button', className: 'dsh-git-btn', onClick: probe }, '再检查一次'),
          h('span', { className: 'dsh-git-set-hint' }, '面板读、写、初始化用的都是这一个'),
        ])),
      ])
    }

    /* ── 这些命令由谁读 ──

       Linux/macOS 上没什么可说的：shell 自己就是 bash，脚本原样交给它。Windows 上 DSH
       的 shell 是 pwsh，而插件的每一条命令都是 POSIX 脚本 —— 它们要由一个真的 POSIX
       shell 读（Git for Windows 的 sh.exe）。找不到它时面板一行都读不出来，屏幕上那句
       「目录不存在」看不出是这个原因，所以这一行必须说。 */
    function shellRow(tool) {
      if (tool == null || tool.shell == null) return null
      const shell = tool.shell
      if (shell.kind === 'native') return null
      const none = shell.kind !== 'git-sh'
      return setRow('读命令的 shell',
        h('span', { className: none ? 'dsh-git-set-hint dsh-git-warn' : 'dsh-git-set-hint' },
          none
            ? 'Windows 上这个插件的命令要由 POSIX shell 读，而没找到 Git for Windows 的 sh.exe：'
              + '找过 Git 的三个默认安装点，也找过 PATH 上每个 git.exe 旁边的 usr\\bin。'
              + '装上 Git for Windows（或把它的 cmd 目录放进 PATH），面板才能读到仓库。'
            : shell.path + '（Git for Windows）'))
    }

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
      const option = function (one) {
        return h('option', { key: String(one.value), value: String(one.value) }, one.label)
      }
      const select = function (value, options) {
        return h('select', {
          className: 'dsh-git-input dsh-git-set-input',
          value: value,
        }, options.map(option))
      }

      return h('div', {
        className: 'dsh-git-set',
        ref: function (node) {
          loadSettings(node != null ? node.ownerDocument : null)
          loadPluginConfig()
        },
      },
        h('div', { className: 'dsh-git-set-h' }, SETTINGS_NAV_LABEL),
        h('div', { className: 'dsh-git-set-intro' }, '分两层：跟随插件的配置（写进部署目录旁的 json，换浏览器也一致），和只影响本浏览器外观与节奏的设置。'),

        /* ── 插件自己的配置 ── */
        setCard('插件配置',
          pluginConfigPath.length > 0
            ? ('保存在 ' + pluginConfigPath + '，跟着插件走')
            : '保存在部署配置目录旁的 dsh-git-idea.json，跟着插件走', [
          setRow('初始化仓库的默认分支',
            clearable('init', h('input', {
              className: 'dsh-git-input dsh-git-set-input',
              placeholder: 'main',
              value: pdraft.initBranch,
              onChange: function (event) { setPlugin('initBranch', event.target.value) },
            }), pdraft.initBranch.length > 0, function () { setPlugin('initBranch', '') }, 'dsh-git-clearable-set'),
            '引导页「在此初始化仓库」会用它执行 git init -b；留空则用 git 自己的默认值'),

          setCheck(pdraft.cherryPickRecord === true, false,
            function (event) { setPlugin('cherryPickRecord', event.target.checked) },
            'cherry-pick 时记录来源（-x）'),

          /* 一个工作区里的几个仓库：工作区自己不是仓库时，插件往下找几层（见 69-repos.js）。
             0 是「不找」，也就是这个键出现之前的行为：只认工作区那一个目录。 */
          setRow('往下找几层仓库',
            h('select', {
              className: 'dsh-git-input dsh-git-set-input',
              value: String(pdraft.repoScanDepth),
              onChange: function (event) { setPlugin('repoScanDepth', Number(event.target.value)) },
            }, [
              { value: 0, label: '不找（只看工作区那一个目录）' },
              { value: 1, label: '1 层（只看直接子目录）' },
              { value: 2, label: '2 层（默认）' },
              { value: 3, label: '3 层' },
            ].map(option)),
            '再往里的检出不是「另一个仓库」，是它自己的内部结构'),

          pluginConfigError.length > 0 ? noteRow('保存失败：' + pluginConfigError, 'dsh-git-error') : null,
        ]),

        /* ── 面板给 git 的实参 ── */
        setCard('远程同步',
          '这三条是面板给 git 的实参，不是 git 自己的设置：下面没勾的，就是 git 原本的行为（push.default、pull.rebase 照旧生效）。', [
          setCheck(pdraft.fetchPrune !== false, false,
            function (event) { setPlugin('fetchPrune', event.target.checked) },
            'fetch 时删掉远端已经删了的远程分支（--prune）'),
          setCheck(pdraft.pullRebase === true, false,
            function (event) { setPlugin('pullRebase', event.target.checked) },
            'pull 用 rebase 而不是 merge（--rebase）'),
          setCheck(pdraft.pushSetUpstream === true, false,
            function (event) { setPlugin('pushSetUpstream', event.target.checked) },
            '推送没有上游的分支时直接推上去并设上游（push -u）'),
          setRow('也就是',
            h('code', { className: 'dsh-git-set-code' },
              'git fetch --all' + (pdraft.fetchPrune !== false ? ' --prune' : '')
              + ' · git pull' + (pdraft.pullRebase === true ? ' --rebase' : '')
              + ' · ' + (pdraft.pushSetUpstream === true ? 'git push -u <remote> <branch>（没有上游时）' : 'git push（没有上游时由面板问一句）'))),
        ]),

        h(GitToolchainGroup),
        h(GitIdentityGroup),

        /* ── 只写这个浏览器 ── */
        setCard('本浏览器', '只写当前浏览器的 localStorage：这些是外观和使用节奏，换浏览器各管各的。', [
          setCheck(draft.watchEnabled === true, false,
            function (event) { set('watchEnabled', event.target.checked) },
            '后台监测仓库变化，发现变化就自动刷新'),

          setRow('面板打开时每',
            setInline([
              h('input', {
                className: 'dsh-git-input dsh-git-set-num', type: 'number', min: 1, max: 120,
                disabled: watchOff,
                value: String(draft.watchFastSec),
                onChange: function (event) { num('watchFastSec', event.target.value, 1, 120) },
              }),
              h('span', { className: 'dsh-git-set-hint' }, '秒检查一次'),
            ])),

          setRow('只有按钮时每',
            setInline([
              h('input', {
                className: 'dsh-git-input dsh-git-set-num', type: 'number', min: 2, max: 600,
                disabled: watchOff,
                value: String(draft.watchSlowSec),
                onChange: function (event) { num('watchSlowSec', event.target.value, 2, 600) },
              }),
              h('span', { className: 'dsh-git-set-hint' }, '秒检查一次'),
            ])),

          setCheck(draft.watchChip === true, watchOff,
            function (event) { set('watchChip', event.target.checked) },
            '面板关着时也监测，让按钮上的分支名和改动数保持实时'),

          setCheck(draft.hoverSwitch === true, false,
            function (event) { set('hoverSwitch', event.target.checked) },
            '鼠标停在输入框旁的 Git 按钮上，弹出分支切换卡片（点一下就切）'),

          /* 变更页开在「树」还是「扁平」：面板标题栏右边那颗切换按钮改的就是这一个
             值，设置页里一直缺它一格 —— README 却一直把它列在「本浏览器」这张表里。 */
          setRow('变更页视图',
            h('select', {
              className: 'dsh-git-input dsh-git-set-input',
              value: draft.changesView === 'flat' ? 'flat' : 'tree',
              onChange: function (event) { set('changesView', event.target.value) },
            }, [
              { value: 'tree', label: '目录树' },
              { value: 'flat', label: '平铺列表' },
            ].map(option)),
            '面板「变更」页右上角那颗切换按钮也是它'),

          setRow('面板尺寸',
            setInline([
              h('span', { className: 'dsh-git-set-hint' },
                panelSize.w > 0 || panelSize.h > 0
                  ? (String(panelSize.w) + ' × ' + String(panelSize.h) + ' 像素')
                  : '跟随输入框宽度 / 74vh'),
              h('button', {
                type: 'button', className: 'dsh-git-btn',
                onClick: function () { publishPanelSize({ w: 0, h: 0 }); savePanelSize() },
              }, '恢复默认尺寸'),
            ])),

          setRow('切换器的记忆',
            setInline([
              h('span', { className: 'dsh-git-set-hint' }, '最近使用与收藏只写在这个浏览器里'),
              h('button', {
                type: 'button', className: 'dsh-git-btn',
                onClick: function () { clearBranchMemory() },
              }, '清除最近使用与收藏'),
            ])),

          /* 「本浏览器」这一层其实是三样东西：上面这些外观与节奏（一份设置记录）、
             面板尺寸、切换器的收藏与排序。既然按钮说的是「全部」，那就得是全部 ——
             以前它只写回第一样，点完之后尺寸和收藏还在，而另外两个按钮各自只管一件。 */
          setRow('',
            setInline([
              h('button', {
                type: 'button', className: 'dsh-git-btn',
                onClick: function () {
                  apply(Object.assign({}, SETTINGS_DEFAULTS))
                  publishPanelSize({ w: 0, h: 0 })
                  savePanelSize()
                  clearBranchMemory()
                },
              }, '本浏览器全部恢复默认'),
              h('span', { className: 'dsh-git-set-hint' }, '外观与节奏、面板尺寸、切换器的收藏与排序 —— 一起回到初始状态'),
            ])),
        ]))
    }
