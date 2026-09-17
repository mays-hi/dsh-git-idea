# dsh-git-idea

把 Git 的日常操作搬进 DSH 会话：输入框左侧的仓库 chip，挂在它上面的浮层面板（分支树 / 提交历史 + 图 / 变更与提交 / 提交详情），以及一个 Settings 页。**它不向 DSH 注册任何模型工具**（理由见「不注册工具」）。

> A git panel for DeepSeek Harness: a repository chip in the composer, a branch tree / commit graph / working tree / commit detail panel, and a settings page. It registers no model tools.

仓库：<https://github.com/mays-hi/dsh-git-idea>

---

## 功能

- **仓库 chip**：会话输入框左侧显示当前仓库、分支和改动数；点它开面板。鼠标停在上面弹出分支切换卡片（可关）。
- **分支树**：按 `HEAD / 本地 / 远程` 分组，支持搜索、收藏，行尾 `›` 是分支可执行的动作。
- **提交历史 + 图**：一次分页 200 条，列表底部「加载更多」；虚拟化只渲染视口内的行。筛选支持正则 `.*`、区分大小写 `Cc`、`分支:`、`作者:`。开启筛选时提交图按真实 DAG 排道，跨过被筛掉的提交画虚线。
- **提交详情**：选中提交后显示作者、时间、引用、提交信息和文件列表。
- **变更与暂存**：分「变更」和「新增的文件」两组，可切树 / 平铺两种视图；勾选框暂存或取消暂存，分组标题的框对整组生效；未跟踪目录折叠成一行，展开才读取，勾选整目录等于 `git add <dir>`。
- **文件差异**：在变更树或提交详情里单击文件，patch 直接占满正文，可返回、重读、暂存 / 取消暂存。四种状态：`staged`、`worktree`、`untracked`、`commit`；二进制只显示提示，不打印乱码。
- **引导页**：工作区还不是仓库时，显示「打开这个目录」和「在此初始化仓库」；机器上没有 git 时同一页改说这一件事，并把路径框和初始化按钮都收起来 —— 这两件事都不是出路，唯一能做的是装好之后点一次「打开这个目录」。
- **跟随会话沙箱**：所有 git 命令按当前会话解析出的 sandbox policy 发出——会话只读，插件就只读；会话可写，插件就能写它被指到的仓库。

面板是挂在输入框上方的浮层，不是可停靠的工具窗。

---

## 安装

要求 DSH `0.1.5-rc.1` 及兼容版本（peer：`@deepseek-ai/cordis ^4.0.2`）。

```sh
# 从 npm
dsh plugin --profile web add dsh-git-idea

# 或直接从 GitHub
dsh plugin --profile web add github:mays-hi/dsh-git-idea

# 本地开发
dsh plugin --profile web add /path/to/dsh-git-idea
```

装完**重启 `dsh web`**（bundle 在启动时读取）。若报 `ERR_PNPM_ADDING_TO_ROOT`，在包名前加 `-w`。

> 如果 DSH 里已经跑着旧版动态插件（`<DSH_HOME>/dsh-git-idea` 那个桥），先停掉它再装 —— 两个都装着就是两份 chip、两个面板在同一个 slot 上。

---

## 使用

面板打开时停在**历史**页；`变更` 页签上带未提交文件数。

**手势**（和 IDEA 的树一致）：

| 行 | 单击 | 双击 / 点三角 |
|---|---|---|
| 目录行（分支树、变更树、提交文件树） | 只选中 | 展开 / 折叠 |
| 未跟踪目录（git 折叠成一行的那种） | 只选中，不发读取 | 读取并展开 |
| 分支行 | 只选中 | 把历史切到该分支 |
| 分组标题（HEAD / 本地 / 远程） | 只选中 | 展开 / 折叠 |
| 文件行 | 打开差异 | — |
| 分组标题最左的复选框 | 整组进 / 出索引 | — |

**仓库范围**：看的是会话工作区**它自己**——只检查 `<dir>/.git`，不向上查找父目录，也不看子目录。

---

## 设置

Settings → **dsh-git-idea配置**。分两层。

**插件级**（写入 `$DSH_HOME/dsh-git-idea.json`，默认 `~/.dsh/dsh-git-idea.json`，换浏览器一致）：

| 项 | 默认 | 说明 |
|---|---|---|
| 初始化仓库的默认分支 | `main` | 引导页「在此初始化仓库」执行 `git init -b <值>`；留空用 git 自己的默认值 |
| cherry-pick 时记录来源（`-x`） | 关 | 提交时是否带上 `-x` |

**浏览器级**（只写当前浏览器的 localStorage）：

| 项 | 默认 | 说明 |
|---|---|---|
| 后台监测仓库变化并自动刷新 | 开 | 关掉后下面的节奏选项一并失效 |
| 面板打开时每 N 秒检查 | 3（1–120） | |
| 只有按钮时每 N 秒检查 | 15（2–600） | |
| 面板关着时也监测 | 开 | 让 chip 上的分支名和改动数保持实时 |
| 悬停弹出分支切换卡片 | 开 | 鼠标停在 Git 按钮上弹出，点一下切换 |
| 面板尺寸 | 跟随输入框宽度 / 74vh | 可恢复默认 |
| 变更页视图 | 树 | 或平铺列表 |
| 切换器记忆 | — | 可清除最近使用与收藏 |

---

## 不注册工具

这个插件给 DSH 的只有 **UI 和它自己的 RPC 通道**：24 条 `host.call('git/…')`（面板、chip、
设置页走的就是它们）。模型要跑 git 本来就有 `bash`，所以这里不注册任何工具。

以前注册过 8 个（`git`、`git_status`、`git_log`、`git_diff`、`git_commit`、`git_branch`、
`git_stash`、`git_sync`），撤掉时量过代价：

| 量到的 | 数 |
|---|---|
| 这 8 个工具的 schema | **7210 字节／每次请求**（约 1800 token，跟这一轮要不要碰 git 无关） |
| 只为它们存在的 Host 代码 | **约 908 / 2577 行（35%）**：`40-tools` 533 行、`20-safety` 里 160 行（`classify`、受保护分支、`scanArgv`……）、`30-render` 里 215 行（那几个渲染器和 diff 卡） |
| 客户端调用工具的次数 | **0** —— 面板从头到尾只走 `host.call('git/…')`，所以撤工具对 UI 零影响 |

那道"危险命令要 `confirm: true`、保护分支不可强推"的闸只拦模型这条通路（`classify` 只被
工具调用），而 `bash git push --force` 永远在 —— 它是**建议，不是边界**。面板那条路更是从来
就没有 force：`git/push` 发出去的是 `git push` 或 `git push -u <remote> <branch>`。

撤掉之后留下的两件事，各有各的归处：

- `repoRelativePath`（路径判据）搬到 `60-reads`，因为 RPC 那条路一直在用它：未跟踪的差异是
  `git diff --no-index -- /dev/null <path>`，那条命令读的是路径指到的任何东西（本机实测：
  绝对路径会读回 `/etc/hostname` 的内容）。它现在有三条断言盯着，包括「拒绝发生在拼命令
  之前、一个子进程都没起」。
- `parseStatusV2` 搬到 `64-history`，它是面板那次读的输入解析。

唯一的代价：`git_diff` 以前会把差异渲染成 GUI 里的原生 diff 卡，现在记录里只有文本。

---

## 开发

源码按功能拆成片段，构建就是按顺序拼接，没有转译、打包或压缩。改代码请改 `src/`。

```sh
node build-package.mjs          # 生成正式包：lib/index.js + client/client.js
node build.mjs                  # 生成动态桥：host.js + client.js
node test/run-all.mjs           # 全部断言（693 条）
node build.mjs --check && node build-package.mjs --check   # 检查产物是否最新
node test/bench.mjs             # 基准：200 条提交的历史列表
node test/bench-branch.mjs      # 基准：300 个分支的切换器
```

`test/run-all.mjs` 在跑任何断言之前会先检查三样东西是否落后于源码：动态桥的两个
产物（`build.mjs --check`）、正式包的两个产物（`build-package.mjs --check`）、以及每个
套件文件（`test/build-suites.mjs --check`）。

### 目录结构

```
package.json          npm / DSH manifest（dsh.bundle patch + dsh.client web）
cordis.patch.yml      bundle 层插入的插件行
lib/index.js          构建产物：Host 半侧（ESM，插件对象 + 同源 RPC 路由）
client/client.js      构建产物：Client 半侧（__ModuleLoader__ bundle）
src/host/*.js         Host 源码片段（10 个）
src/client/*.js       Client 源码片段（23 个）
src/pkg/*.js          正式包的 prelude / postlude（harness shim、host.call）
build-package.mjs     正式包构建
build.mjs             动态桥构建
host.js client.js     构建产物：动态桥读取的两个半侧（旧运行方式，保留）
test/                 断言套件与性能基准
```

Host 与 Client 的片段各自共享一个作用域：一个片段可以使用它上面的片段定义的东西，反之不行。

---

## 许可

MIT
