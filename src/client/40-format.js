    const LANE_COLORS = ['#4a86e8', '#22a06b', '#d98e04', '#9b59b6', '#d64545', '#0e9aa7', '#b8860b', '#c2478f']
    const ROW_H = 26
    /* One page of history. Big enough that nobody scrolls to the end of it by
       accident, small enough that the first paint of a large repository is a
       single read; `git log` says whether there is more. */
    const PAGE_COMMITS = 200
    const LANE_W = 14

    const DATE_PRESETS = [
      { id: 'all', label: '全部时间', since: '' },
      { id: 'today', label: '今天', since: 'midnight' },
      { id: 'week', label: '最近 7 天', since: '7 days ago' },
      { id: 'month', label: '最近 30 天', since: '30 days ago' },
      { id: 'quarter', label: '最近 90 天', since: '90 days ago' },
    ]

    function dateSince(id) {
      for (let i = 0; i < DATE_PRESETS.length; i += 1) if (DATE_PRESETS[i].id === id) return DATE_PRESETS[i].since
      return ''
    }

    function relativeDate(iso) {
      if (typeof iso !== 'string' || iso.length < 16) return text(iso)
      const year = parseInt(iso.slice(0, 4), 10)
      const month = parseInt(iso.slice(5, 7), 10)
      const day = parseInt(iso.slice(8, 10), 10)
      const clock = iso.slice(11, 16)
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const that = new Date(year, month - 1, day)
      const days = Math.round((today.getTime() - that.getTime()) / 86400000)
      if (days === 0) return '今天 ' + clock
      if (days === 1) return '昨天 ' + clock
      return iso.slice(0, 10)
    }

    function statusClass(status) {
      const head = text(status).charAt(0)
      if (head === 'A') return ' dsh-git-st-A'
      if (head === 'D') return ' dsh-git-st-D'
      if (head === 'R') return ' dsh-git-st-R'
      if (head === 'C') return ' dsh-git-st-C'
      if (head === '?') return ' dsh-git-st-U'
      return ' dsh-git-st-M'
    }

    function statusLabel(status) {
      const head = text(status).charAt(0)
      if (head === 'A' || head === 'D' || head === 'R' || head === 'C' || head === 'U') return head
      if (head === '?') return '?'
      return 'M'
    }

    /* ── "this path is an addition" is one question, asked in one place ──

       `git status --porcelain=v2` prints the index letter and the worktree letter
       together, so a path the index has added reads `A.` (added, unchanged since)
       or `AM` (added, then edited) — a bare `A` is a shape this code base only
       ever made up itself. Two places ask the question: which changelist a row
       belongs to, and what an untick is about to turn this path back into. They
       answered it differently — one took the first letter, the other compared the
       whole string to `A` — and the second one was wrong, so unticking a new file
       (already confirmed by a read, and therefore carrying `A.`) was predicted as
       "modified in the worktree": the row jumped into 默认变更列表 for as long as
       `git restore --staged` and the read behind it took, then jumped back. Asked
       once, the two cannot drift apart again. */
    function addedInIndex(code) {
      return text(code).slice(0, 1) === 'A'
    }

    function splitRefs(value) {
      const raw = text(value)
      if (raw.length === 0) return []
      const parts = raw.split(', ')
      const out = []
      for (let i = 0; i < parts.length; i += 1) if (parts[i].length > 0) out.push(parts[i])
      return out
    }

    function refKind(label) {
      if (label.indexOf('HEAD') === 0) return 'head'
      if (label.indexOf('tag: ') === 0) return 'tag'
      return 'remote'
    }

