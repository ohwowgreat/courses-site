// "## At a glance" is a headerless two-column key/value table on 138 published pages,
// and the rows a student opens the page for — the dates, the day count, the AOs — were
// buried three rows down in it. Those lift into a strip of cells above the table, the
// shape the 9607 study guide uses for its masthead; the prose rows stay in the table
// below.
//
// Rows are chosen by LABEL and never by value length. An earlier cut promoted any row
// whose value happened to be short, and the identical "Dates" row landed in the strip on
// lesson 3 and in the table on lesson 4 — the strip changed shape week to week, which
// defeats the point of a masthead. A long value is a typography problem, and .stat
// wraps. Measured over all 138 pages: 120 get a strip, 18 are left exactly as they are.
//
// Idempotent: after a pass the line under the heading is `<dl`, not `|`, so a second run
// bails at the shape check. sync.mjs can therefore apply it to an already-synced tree.

// Exported so sync.mjs's code linker can leave these rows alone: a wikilink
// in a promotable value would demote the row out of the strip (see the
// `promote` test below), changing the masthead's shape page to page.
export const STAT_LABELS = [
  // lesson pages (117 of the 138)
  "Dates",
  "Date",
  "Days",
  "Sessions",
  "Session",
  "Session codes",
  "AO focus",
  // assessment pages (21)
  "Due",
  "Sits",
  "Returned",
  "Marks",
  "Assesses",
]

// A value is a headline clause plus, usually, a qualifier: "Fri 2026-11-27, submitted in
// session" · "5 days (S10) — Unit 4 opens". The head carries the cell, the qualifier
// becomes a third line under it — dropping it would lose the half of the row that says
// what the date means.
const STAT_SEP = /^(?:,\s|\s[—–]\s|;\s|\.\s|\s·\s)/

// Split at the first separator sitting at bracket depth 0. A plain regex cut
// "AO2 + AO3 (A3, scaled to 50)" at the comma inside the parenthesis and shipped
// "AO2 + AO3 (A3" as the cell with an unclosed bracket — a separator inside brackets is
// punctuation within one clause, not a break between two.
function splitClause(value) {
  let depth = 0
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === "(" || c === "[") depth++
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1)
    else if (depth === 0 && i > 0) {
      const m = value.slice(i).match(STAT_SEP)
      if (m) return [value.slice(0, i).trim(), value.slice(i + m[0].length).trim()]
    }
  }
  return [value, ""]
}

// Local copy, as in course-events.mjs and calendar-grid.mjs: the registers carry
// `[[path\|alias]]` wikilinks whose escaped pipe must not be read as a column break.
function splitRow(line) {
  const cells = line.split(/(?<!\\)\|/)
  if (cells.length && cells[0].trim() === "") cells.shift()
  if (cells.length && cells[cells.length - 1].trim() === "") cells.pop()
  return cells
}

const escHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// Inline markdown inside a raw HTML block is NOT parsed — the block is an mdast `html`
// node, which no text transform visits — so **bold** would ship as four literal
// asterisks. Convert the two marks the cells actually carry, escaping first so the
// conversion cannot be spoofed by content.
const statInline = (s) =>
  escHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")

// The shared builder. Every strip on the site goes through here — the ones lifted from
// an At-a-glance table below, and the hand-composed ones sync.mjs puts on the landing
// page and the course overviews — so one markup change reaches all of them.
//
// cells: [{ label, value, note? }]. `value` and `note` may carry **bold**/*italic*; a
// value is never a link, because a wikilink inside a raw HTML block does not resolve.
//
// The trailing blank line is load-bearing: an HTML block runs to the next blank line, so
// without it whatever follows is swallowed into the block and ships as literal text.
export function stripHtml(cells) {
  if (cells.length < 2) return ""
  const body = cells
    .map(
      (c) =>
        `  <div class="stat"><dt>${escHtml(c.label)}</dt><dd>${statInline(c.value)}` +
        (c.note ? `<span class="stat-x">${statInline(c.note)}</span>` : "") +
        `</dd></div>`,
    )
    .join("\n")
  return `<dl class="stat-strip">\n${body}\n</dl>\n\n`
}

export function statStrip(body) {
  const lines = body.split("\n")
  const h = lines.findIndex((l) => l.trim() === "## At a glance")
  if (h === -1) return body

  let head = h + 1
  while (head < lines.length && lines[head].trim() === "") head++
  // Anything but the exact shape and the page is left alone. This runs over 138 pages of
  // vault-authored markdown, and the only acceptable failure is "renders as it did
  // yesterday".
  if (!lines[head]?.trimStart().startsWith("|")) return body
  if (!/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[head + 1] ?? "")) return body

  const rows = []
  let end = head + 2
  while (end < lines.length && lines[end].trimStart().startsWith("|")) {
    const cells = splitRow(lines[end])
    if (cells.length !== 2) return body // a wider table: not the shape we know
    rows.push({ line: lines[end], label: cells[0].trim(), value: cells[1].trim() })
    end++
  }

  const stats = []
  const keep = []
  for (const r of rows) {
    // Wikilinks resolve on text nodes only (ofm.ts uses mdastFindReplace, which never
    // visits an html node), so a [[link]] inside the raw HTML below would ship as
    // literal brackets. Any link-bearing row stays in the table, where the transformer
    // still sees it — which is also why the leftovers stay a markdown table rather than
    // becoming a second <dl>. It keeps insertHandouts's /\| Unit \|/ anchor alive too.
    const promote = STAT_LABELS.includes(r.label) && !/\[\[|\]\(/.test(r.value)
    ;(promote ? stats : keep).push(r)
  }
  // One cell is not a strip, it is a stray box.
  if (stats.length < 2) return body

  const cells = stats.map((s) => {
    let [v, x] = splitClause(s.value)
    // A trailing parenthetical is a qualifier too, but only once the head is long enough
    // to wrap the cell — "5 days (S10)" must stay whole. Restricted to a single bracket
    // pair closing the value: "3 days (W13, reduced — Seniors take Thu–Fri) + 5 days
    // (W14)" has two, and the lazy match cut at the first "(" and stranded the inner ")"
    // in the qualifier. A value that complex is left whole and allowed to wrap.
    if (v.length > 40 && v.endsWith(")") && (v.match(/\(/g) || []).length === 1) {
      const p = v.match(/^(.+?)\s\((.+)\)$/)
      if (p) [v, x] = [p[1].trim(), x ? `${p[2]}. ${x}` : p[2]]
    }
    return { label: s.label, value: v, note: x }
  })

  const strip = stripHtml(cells).split("\n").slice(0, -1)
  const table = keep.length ? [lines[head], lines[head + 1], ...keep.map((r) => r.line)] : []
  return [...lines.slice(0, head), ...strip, ...table, ...lines.slice(end)].join("\n")
}
