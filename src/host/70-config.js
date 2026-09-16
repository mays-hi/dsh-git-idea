/* ── plugin-side configuration ──

   Split from the browser-local presentation preferences on purpose. "Which
   branch should a new repository start on" is a property of this plugin, not of
   whoever happens to be looking at it, so it belongs beside the deployment's
   own settings rather than in one browser's localStorage. When this becomes an
   ordinary plugin this file is exactly what its config section would own. */

let configPathCache
let configCache = null

async function configPath() {
  if (configPathCache !== undefined) return configPathCache
  const probe = await invoke('printf %s "${DSH_HOME:-$HOME/.dsh}"', {}, null, { timeoutMs: 10000 })
  const home = probe.exitCode === 0 ? probe.stdout.trim() : ''
  configPathCache = home.length > 0 ? home + '/dsh-git-idea.json' : null
  return configPathCache
}

function normalizeConfig(raw) {
  const out = { initBranch: 'main', cherryPickRecord: false }
  if (raw == null || typeof raw !== 'object') return out
  if (isStr(raw.initBranch)) out.initBranch = raw.initBranch.trim().slice(0, 120)
  out.cherryPickRecord = raw.cherryPickRecord === true
  return out
}

async function readConfigFile() {
  if (configCache !== null) return configCache
  const path = await configPath()
  const fsService = ctx.get('fs')
  if (path === null || fsService === undefined) { configCache = normalizeConfig(null); return configCache }
  try {
    const target = await fsService.resolve(path)
    const info = await fsService.stat(target)
    if (info === undefined) { configCache = normalizeConfig(null); return configCache }
    configCache = normalizeConfig(JSON.parse(await fsService.readText(target)))
  } catch (error) {
    console.error('dsh-git-idea: could not read the plugin config', String(error))
    configCache = normalizeConfig(null)
  }
  return configCache
}

async function writeConfigFile(raw) {
  const path = await configPath()
  if (path === null) return { ok: false, error: '无法确定配置目录' }
  const fsService = ctx.get('fs')
  if (fsService === undefined) return { ok: false, error: '文件系统服务不可用' }
  const next = normalizeConfig(raw)
  try {
    const target = await fsService.resolve(path)
    await fsService.writeText(target, JSON.stringify(next, null, 2) + '\n')
    configCache = next
    return { ok: true, path: path, config: next }
  } catch (error) {
    const detail = error != null && error.message !== undefined ? String(error.message) : String(error)
    return { ok: false, error: detail, path: path }
  }
}

async function initSnapshot(input) {
  const target = repoFrom(input, null)
  if (target === undefined) return { ok: false, error: 'no-path', stderr: '无法确定要初始化的目录', repo: null }
  const kind = await pathKind(input, target)
  if (kind !== 'dir') {
    return {
      ok: false, error: 'bad-path', repo: target,
      stderr: kind === 'file' ? '目标是一个文件，不是目录' : '目标目录不存在，无法在此初始化仓库',
    }
  }
  const branch = input != null && isStr(input.branch) ? input.branch.trim() : ''
  if (branch.length > 0) return await panelMutate({ repo: target }, ['init', '-b', branch])
  return await panelMutate({ repo: target }, ['init'])
}

