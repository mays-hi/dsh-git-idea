#!/usr/bin/env node
/* Every suite, in one command, against whatever is on disk right now.
   `node test/run-all.mjs` — and it refuses to trust a green run when the built
   host.js/client.js no longer match src/, because that is the failure mode this
   layout can produce and no assertion inside a suite can see it. */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const ROOT = path.dirname(HERE)

/* Suites that count ✓ / ✗ in their output. */
const COUNTING = [
  'gp34b-client-test.mjs',
  'gp35-panel-test.mjs',
  'gp36-click-test.mjs',
  'gp37-logpanel-test.mjs',
  'gp38-flyout-test.mjs',
  'gp39-session-test.mjs',
]
/* Suites that report by exit code and print their own lines. */
const PROSE = ['gp34a-host-test.mjs', 'gp34d-config-test.mjs', 'gp34e-bridge-test.mjs']

function run(file) {
  const started = Date.now()
  const result = spawnSync(process.execPath, [path.join(HERE, file)], { encoding: 'utf8' })
  const out = (result.stdout || '') + (result.stderr || '')
  const mark = (text) => (out.match(new RegExp(text, 'g')) || []).length
  return {
    file: file,
    code: result.status,
    passed: mark('✓'),
    failed: mark('✗'),
    ms: Date.now() - started,
    out: out,
  }
}

const check = spawnSync(process.execPath, [path.join(ROOT, 'build.mjs'), '--check'], { encoding: 'utf8' })
if (check.status !== 0) {
  console.error((check.stdout || '') + (check.stderr || ''))
  console.error('run `node build.mjs` first: the suites would otherwise test a stale artifact')
  process.exit(1)
}

let passed = 0
let failed = 0
let broken = 0
for (const file of COUNTING.concat(PROSE)) {
  const row = run(file)
  passed += row.passed
  failed += row.failed
  const bad = row.code !== 0 || row.failed > 0
  if (bad) broken += 1
  const label = row.passed > 0 ? '✓ ' + row.passed + (row.failed > 0 ? '  ✗ ' + row.failed : '') : row.code === 0 ? 'ok' : 'exit ' + row.code
  console.log((bad ? '✗ ' : '  ') + file.padEnd(24) + label.padEnd(14) + String(row.ms).padStart(6) + 'ms')
  if (bad) {
    console.log(row.out.split('\n').filter((line) => line.indexOf('✗') >= 0 || line.indexOf('Error') >= 0).slice(0, 20).join('\n'))
  }
}
console.log('')
console.log('assertions: ' + passed + ' ✓  ' + failed + ' ✗      suites with a problem: ' + broken)
const summary = JSON.stringify({ passed: passed, failed: failed, broken: broken, at: new Date().toISOString() })
fs.writeFileSync(path.join(HERE, '.last-run.json'), summary + '\n')
process.exit(failed > 0 || broken > 0 ? 1 : 0)
