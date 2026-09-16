# dsh-git-idea

一个把 Git 的日常操作搬进 DSH 会话里的插件：输入框左侧的仓库 chip、挂在它上面的面板
（分支树 / 提交历史 + 图 / 变更与提交 / 提交详情），以及一个 Settings 页。
Host 侧另外注册了 8 个模型工具和 22 个 RPC。

当前以**动态 Cordis 插件**的形式运行：动态插件本体只是一段「源码桥」，
真正的一半在下面这两个文件里。

## 目录

```
host.js              构建产物：Host 半侧（被桥读取并求值）—— 不要直接改
client.js            构建产物：Client 半侧（被桥读取并求值）—— 不要直接改
build.mjs            源码树 → 上面两个文件的按序拼接
src/host/*.js        Host 源码片段（9 个）
src/client/*.js      Client 源码片段（22 个）
test/                断言套件 + 性能基准
dsh-git-idea.json    （运行时生成）插件配置，默认 {initBranch:'main', cherryPickRecord:false}
bridge.log           （运行时生成）桥每次装载 Host 半侧的结果
```

`host.js` / `client.js` 的第一行就写着「GENERATED」。它们只是 `src/` 按
`build.mjs` 里那份清单顺序拼起来的结果，没有转译、没有打包、没有压缩 ——
片段之间共享同一个作用域，和当初的单文件完全一样。改代码请改 `src/`。

## 常用命令

```sh
node build.mjs            # 重新生成 host.js / client.js
node build.mjs --check    # 只检查产物是不是最新的（测试跑之前会先查这个）
node test/run-all.mjs     # 全部套件（280 条断言）
node test/bench.mjs       # 性能基准：200 个提交的历史列表
node test/bench-branch.mjs# 性能基准：300 个分支的切换器
node test/build-suites.mjs# 改了 harness/body 之后重新拼出 gp37~gp40 与基准文件
```

改了源码之后要让它生效：`node build.mjs`，然后把这个动态插件 **停止再运行**
（桥在运行时会重新读文件），浏览器无需刷新。

## 源码片段

Host（`src/host/`）：

| 片段 | 内容 |
|---|---|
| `00-plugin` | `return { apply(ctx) {` 与服务检查 |
| `10-shell` | shell 原语、`git` / `gitNet` / `gitC` 三个调用姿势 |
| `20-safety` | 只读子命令、受保护分支、`classify` 对 argv 的危险度判定 |
| `30-render` | 工具返回值的人类可读渲染、`status --porcelain=v2` 解析 |
| `40-tools` | 8 个模型工具的 `define` |
| `50-graph` | 历史图的泳道布局 |
| `60-reads` | 每仓库读缓存、路径解析、panel/graph/refs/branches/commit-detail 的读与写 |
| `70-config` | 插件配置文件与 `init` |
| `80-rpc` | 22 个 `onRpc(...)` 注册 |

Client（`src/client/`）：

| 片段 | 内容 |
|---|---|
| `00-plugin` | 服务与 React 能力垫片（`memo` / `useCallback` / `useLayoutEffect`） |
| `10-state` | 唯一的 signal 工厂、唯一的 localStorage 出口、`rpc()` 与 `failureText()` |
| `12-window` | 长列表的窗口化 |
| `20-prefs` | 两层偏好：本浏览器 / 跟随插件 |
| `30-watch` | 仓库变更轮询（面板 3s，chip 15s，页面隐藏时不轮询） |
| `40-format` … `62-branchstate` | 日期、状态、图标、树、缓存等无状态辅助 |
| `70-branchpicker` | 分支切换器（含 IDEA 式子菜单） |
| `80-panel` | 主面板 |
| `90-settings` / `92-chip` / `94-popover` | 设置页、输入框 chip、浮层 |
| `98-register` | 四个 slot 的注册 |

## 界面：照 IDEA 的 Git Log 摆

三栏，每栏顶上都有自己的那一条：

```
┌ Git   变更 │ 历史 ──────────── 仓库路径 [应用] ┐
│ ┌ 搜索分支 ─┐ ┌ 搜索提交… .* Cc 分支:dev 作者 …  ⟨拣选⟩⟨还原⟩⟨标签⟩⟨分支⟩ ┐ │
│ │ HEAD/本地 │ │  图 │ 标题 │ 引用 │ 作者 │ 时间                          │ │ 选择一个提交
│ │ /远程     │ │                                                    │ │ ...
└ └───────────┘ └────────────────────────────────────────────────────┘ ┘
```

- **左栏**：顶上是分支搜索（IDEA 的 Search）。有搜索词时树强制展开、分组条数
  显示的是命中数 —— 折叠在组里的匹配等于没匹配。
- **中栏**：筛选在左、提交操作在右，中间是 IDEA 的 `.*`（正则）和 `Cc`
  （区分大小写）两个开关。两个开关默认都关，也就是改动之前的行为：字面量、忽略大小写。
  开关状态会进 `git/graph` 的参数，也进主机侧的缓存键。
- **分页**：历史一次读一页（200 条），`git log` 多要一条来判断「还有没有」；
  还有的时候列表最后一行是「已显示 N 条 · 加载更多」，点了就再要一页。
  虚拟化只画视口里的行，所以多要一页不会让浏览器多画任何东西。
- **右栏**：没选中提交时是 IDEA 的空态版式（中间一句提示，底部一句选中状态）。

面板本身仍是挂在输入框上方的浮层（DSH 的面板就是这么承载的），
不是 IDEA 那种可停靠的工具窗。

## 性能

窗口化（只渲染滚动容器装得下的行，上下用占位块撑住高度）与行级 `memo`
（提交行、分支行、图各自成组件）之后的实测，单位是 mock-React 下单遍组件树的耗时：

| 场景 | 之前 | 之后 |
|---|---|---|
| 200 个提交，600px 视口：DOM 节点 | 1321 | 315 |
| 200 个提交：SVG 路径 | 216 | 49 |
| 200 个提交：单遍渲染 | 0.46ms | 0.10ms |
| 点一个提交后的单遍渲染 | 0.46ms | 0.14ms（memo 命中 329 次） |
| 300 个分支：单遍渲染 | 2.59ms | 0.69ms |
| 300 个分支：鼠标扫过 9 行后 | 2.20ms | 0.54ms（memo 命中 8799 次） |

页面**报不出滚动容器高度**时（测试 harness、还没布局完的浏览器）窗口化自动退化成
「全都画出来」，也就是窗口化之前的行为 —— 量不到尺寸不会让任何一行消失。

### 切换工作区为什么曾经要七秒

在真实仓库上量的（`holox_cloud`，3484 个提交，挂在 Windows 盘上）：

| | 之前 | 之后 |
|---|---|---|
| `git/panel`（面板与 chip 的第一帧） | 7044ms | **153ms**（身份读） |
| `git/watch` 每次轮询 | 7012ms | **126ms**（便宜的签名） |
| `git/watch` 只在变更页打开时 | — | 6721ms（这时才值得） |

贵的那一步是 `git status`：它要 stat 工作区里的每一个文件，在这台机器上就是
7 秒。而面板要画第一帧只需要知道「这是不是仓库、在哪个分支、有没有半途的
cherry-pick」—— 那是 0.13 秒的事。所以现在读两段：身份先回来、面板立刻出来，
工作区状态（改动列表、徽标数字）随后补上，两段用不同的缓存键。轮询同理，
只有变更页在看着工作区时才用带 status 的签名。

## 动态插件的来历与恢复

WSL 重启、进程重启都会清掉动态插件。恢复只需要重新定义一次桥（一次批准）：

- pluginId `dshgit-3`，当前包 `pkg-5`，名字 `dsh-git-idea`
- Host 半侧 = `test/gp34-bridge-host.js` 的内容
- Client 半侧 = `test/gp34-bridge-client.js` 的内容
- 桥从 `<DSH_HOME:-$HOME/.dsh>/dsh-git-idea/` 读 `host.js` 与 `client.js` 求值，
  并用 `harness.handle('dsh-git-idea/source')` 把 Client 半侧交给浏览器

两半是**同时**被派发的，而 Client 挂载的那一刻就会 `git/panel`。所以桥先等
Host 半侧装载完成才交付 Client 源码（否则面板会带着一串「未注册」的失败请求
挂上去），装载失败会重试三次并写 `bridge.log`。客户端这边另有一层保险：
`callHost()` 只对「is not registered」这一种拒绝重试（24 次 × 120ms），
其余错误一次就报出来。

`host.js` / `client.js` 的改动不需要重新批准：`node build.mjs` 之后把这个插件
停止再运行即可。只有改**桥本身**才需要新包（`pkg-6` 之类）。

`gitops` 时代的旧名字、旧 localStorage 键、旧目录都已经不再兼容：只认
`<DSH_HOME>/dsh-git-idea`，只读 `dsh.git-idea.*` 这几个键。

## 还没做的

搬成**正式插件包**（`package.json` + `lib/` + `client/`，装进 profile）。那样就不再需要
桥，插件随部署一起升级；迁移要点见同目录之外的研究笔记（`REAL-PLUGIN-API.md`）。
