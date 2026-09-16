/* ─────────────── graph layout ─────────────── */

function layoutGraph(commits, maxLanes) {
  const lanes = []
  const rows = []
  let widest = 1
  for (let i = 0; i < commits.length; i += 1) {
    const commit = commits[i]
    let lane = lanes.indexOf(commit.hash)
    if (lane < 0) {
      lane = lanes.indexOf(null)
      if (lane < 0) {
        if (lanes.length >= maxLanes) lane = lanes.length - 1
        else { lanes.push(null); lane = lanes.length - 1 }
      }
    }
    lanes[lane] = null
    const edges = []
    for (let k = 0; k < commit.parents.length; k += 1) {
      const parent = commit.parents[k]
      let parentLane = lanes.indexOf(parent)
      if (parentLane < 0) {
        if (k === 0) { parentLane = lane; lanes[lane] = parent }
        else {
          parentLane = lanes.indexOf(null)
          if (parentLane < 0) {
            if (lanes.length >= maxLanes) continue
            lanes.push(parent)
            parentLane = lanes.length - 1
          } else lanes[parentLane] = parent
        }
      }
      edges.push({ hash: parent, lane: parentLane })
      if (parentLane + 1 > widest) widest = parentLane + 1
    }
    if (lane + 1 > widest) widest = lane + 1
    rows.push({ lane: lane, edges: edges })
  }
  return { rows: rows, lanes: widest }
}

function parseCommitRecords(stdout) {
  const commits = []
  const records = stdout.split('\u001e')
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i].replace(/^\n+/, '')
    if (record.length === 0) continue
    const fields = record.split('\u001f')
    const parents = fields[7] === undefined || fields[7].length === 0 ? [] : fields[7].split(' ')
    commits.push({
      hash: fields[0] === undefined ? '' : fields[0],
      short: fields[1] === undefined ? '' : fields[1],
      author: fields[2] === undefined ? '' : fields[2],
      email: fields[3] === undefined ? '' : fields[3],
      date: fields[4] === undefined ? '' : fields[4],
      subject: fields[5] === undefined ? '' : fields[5],
      refs: fields[6] === undefined ? '' : fields[6],
      parents: parents,
    })
  }
  return commits
}

