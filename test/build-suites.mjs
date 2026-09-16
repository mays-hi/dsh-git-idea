#!/usr/bin/env node
/* The three gp3x suites are a shared harness plus a body; this glues them, with
   the newline the earlier by-hand concatenation happened to get away with not
   having. Run it after editing the harness or a body. */

import fs from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const harness = fs.readFileSync(path.join(HERE, 'gp37-harness.part'), 'utf8')

const SUITES = [
  ['gp37-body.mjs', 'gp37-logpanel-test.mjs'],
  ['gp38-body.mjs', 'gp38-flyout-test.mjs'],
  ['gp39-body.mjs', 'gp39-session-test.mjs'],
  ['gp40-body.mjs', 'gp40-refactor-test.mjs'],
  ['gp41-body.mjs', 'gp41-watch-test.mjs'],
  ['gp42-body.mjs', 'gp42-diff-test.mjs'],
  ['bench-body.mjs', 'bench.mjs'],
  ['bench-branch-body.mjs', 'bench-branch.mjs'],
]

for (const [body, out] of SUITES) {
  const text = harness + '\n' + fs.readFileSync(path.join(HERE, body), 'utf8')
  fs.writeFileSync(path.join(HERE, out), text)
  console.log(out.padEnd(24) + String(text.length).padStart(9) + ' bytes')
}
