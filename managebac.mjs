// managebac.mjs — build ManageBac load packs from the student-facing content/ tree.
//
// ManageBac has no API for this account, so population happens through its web
// UI in supervised browser sessions. This module does everything that can be
// done outside that browser: it reads content/ (the already-student-facing
// mirror of the vault — sync.mjs has stripped teacher material and reframed
// titles), and emits per course:
//
//   managebac-packs/<key>/manifest.json   every object to create, in load order
//   managebac-packs/<key>/pack.html       the same objects rendered for proofing
//
// plus managebac-state.json bookkeeping: the load sessions record each created
// object's ManageBac URL and content hash there, and `--diff` reports what has
// changed in the packs since the last load so update sessions stay targeted.
//
//   node managebac.mjs                    generate all four course packs
//   node managebac.mjs --course media     one course (key from COURSES)
//   node managebac.mjs --diff             compare fresh packs against state
//
// Object kinds: task (dated graded item), unit (shell fields + full composed
// content), stream (one materials post per unit, carrying the deck/handout
// attachments). Attachment paths are absolute, ready for the browser's file
// picker. Oxbridge is excluded by decision (2026-08-26).

import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createHash } from "node:crypto"
import { join, basename } from "node:path"
import { COURSES } from "./calendar-grid.mjs"
import { courseDetailEvents } from "./course-events.mjs"
import { kb } from "./decks.mjs"

const run = promisify(execFile)

const SITE = "https://courses.dogan.education"
const ROOT = import.meta.dirname
const CONTENT = join(ROOT, "content")
// Bodies come from content/ (already student-facing). Dates, lesson rosters and
// unit spans come from the vault: sync.mjs replaces each lesson's "At a glance"
// table with the contract card, so course-events.mjs finds no dates in content/.
const VAULT = process.env.VAULT ?? "/Users/dogan/Documents/Vaults/Courses/wiki"
const PACKS = join(ROOT, "managebac-packs")
const STATE_FILE = join(ROOT, "managebac-state.json")
const HANDOUTS_DIR = join(ROOT, "quartz", "static", "handouts")
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

// ── Per-course load config ───────────────────────────────────────────────────
// `times`: weekday (0=Sun) → class start, from the confirmed 2026-08-25
// timetable — a task lands due at the start of that day's session. Days with no
// session fall back to 08:00 (school day start).
// `offGrid`: lesson number → the dates it actually runs, for the sessions that
// sit outside the weekly grid. The post-exam return days and the exam-office
// sits are not timetabled periods, so they are neither filtered against the
// weekly grid nor given a period time; they load date-only.
// `sessions`: weekday (0=Sun) → [start, end] of that day's class, straight from
// [[shared/teacher-timetable]] (aSc export, 2026-08-21). Doubles carry the full
// 90-minute window. This is what dates a lesson; `times` only dates a task.
// `handoutUnits`: which unit's materials post carries each handout PDF. The site
// anchors these on library/unit pages; here they need a unit to travel with.
const LOAD = {
  "a-level": {
    mbClassId: 11501153, // CAIE A Level AS Art & Design(AL26ART21) AS (Grade 11)
    times: { 1: "09:50", 4: "12:35", 5: "09:50" },
    // Mon P9 · Tue P3 · Thu P6 · Fri P3+P4 double.
    sessions: { 1: ["15:35", "16:20"], 2: ["09:50", "10:35"], 4: ["12:35", "13:20"], 5: ["09:50", "11:30"] },
    // "The Final" (the 20% EoT category) is a prose section in the register, not
    // a table row, and carries no date yet ("confirmed in class", inside the exam
    // window) — surfaces on the undated list until Doğan fixes a date.
    extraTasks: [{ code: "EoT", due: null, page: "classes/a-level-art-design/assessments/9479-s1-the-final" }],
  },
  media: {
    mbClassId: 11501162, // CAIE A Level AS Media Studies(AL26MED23) AS (Grade 11)
    times: { 1: "12:35", 3: "12:35", 4: "08:00", 5: "12:35" },
    // Mon P6 · Wed P6+P7 double · Thu P1 · Fri P6.
    sessions: { 1: ["12:35", "13:20"], 3: ["12:35", "14:15"], 4: ["08:00", "08:45"], 5: ["12:35", "13:20"] },
    // L19's two exam sits are slots the exam office sets, inside the 01-11 → 01-18
    // window; only Wed 01-20 is a timetabled double, and it loads with the rest.
    offGrid: { 19: ["2027-01-11", "2027-01-18", "2027-01-20"] },
    guidePdf: { source: "media-studies/c1-foundation-portfolio.html", attachTo: ["task:A3", "unit:2"] },
    points: { A1: 25, A3: 50 }, // register-stated mark totals; others default
  },
  "art-app": {
    mbClassId: 11501190, // CAIE A Level Art Appreciation(AL26AAP34) A (Grade 12)
    times: { 1: "10:45", 2: "12:35", 3: "08:00", 5: "08:55" },
    // Mon P4 · Tue P6+P7 double · Wed P1 · Fri P2.
    sessions: { 1: ["10:45", "11:30"], 2: ["12:35", "14:15"], 3: ["08:00", "08:45"], 5: ["08:55", "09:40"] },
    // The three return days run outside the weekly grid, which is why the
    // Thursday is there at all (the course has no Thursday period).
    offGrid: { 15: ["2027-01-19", "2027-01-20", "2027-01-21"] },
    handoutUnits: { "*": 3 }, // all nine U3 food-unit handouts
  },
  // The course's second section: HS Art Appreciation DD26AAP13, G11, 16
  // students, on the DDP gradebook. Same vault content (base: art-app), own
  // class, categories remapped to the DDP labels (decided 2026-08-26).
  "art-app-hs": {
    base: "art-app",
    mbClassId: 11503610, // HS Art Appreciation - DD26AAP13 (Grade 11)
    times: { 1: "10:45", 2: "12:35", 3: "08:00", 5: "08:55" },
    sessions: { 1: ["10:45", "11:30"], 2: ["12:35", "14:15"], 3: ["08:00", "08:45"], 5: ["08:55", "09:40"] },
    // The three return days run outside the weekly grid, which is why the
    // Thursday is there at all (the course has no Thursday period).
    offGrid: { 15: ["2027-01-19", "2027-01-20", "2027-01-21"] },
    handoutUnits: { "*": 3 },
    // The AP scheme, per shared/bnds-ap-assessment-policy: Majors 50%
    // (Assessments 30% + Performance Tasks 20%) · Minors 30% · Final Exam 20%.
    // ManageBac calls Performance Tasks "Others (Major)".
    categoryMap: {
      Attainment: "Assessments (Major)",
      "Course Skills": "Minors",
      // Corrected 2026-08-29: was "Others (Major)", a 20% Major band. There is
      // no Learning Behaviour category on the AP side; the postings are Minors.
      "Learning Behavior": "Minors",
      Final: "Final Exam",
    },
    // Boards are Performance Tasks, essays are Assessments. Not derivable —
    // it is a classification of the work, so it is stated.
    categoryByCode: { A1: "Others (Major)", A4: "Others (Major)" },
    includeLB: true, // the LB rows are read, so the Minors number by date across the whole band
    emitLB: false, // but not published: the postings are Doğan's to create
    spellOutCodes: true,
  },
  pal: {
    mbClassId: 11501114, // CAIE IGCSE Pre-AL Art & Design(AL26ART11) Core (Grade 10)
    times: { 3: "09:50" },
    // Wed P3+P4 double, the course's only slot.
    sessions: { 3: ["09:50", "11:30"] },
    // The EoT portfolio is a prose section in the register (confirmed Wed
    // 2027-01-06), not a table row.
    extraTasks: [
      { code: "EoT", due: "2027-01-06", page: "classes/pre-a-level-art-design/assessments/pal-s1-eot-semester-portfolio" },
    ],
    handoutUnits: {
      "drawing-basics": 1,
      "ao-guide": 1,
      "photography-vocabulary": 2,
      "photography-exposure": 2,
      "photography-digital-workspace": 2,
      "photography-websites": 2,
      "collage-instructions": 3,
      "collage-presentation": 3,
      "carving-step-by-step": 4, // printmaking variant material; U4 either way
    },
  },
}

const TAUGHT = Object.keys(LOAD)

// ── Small helpers ────────────────────────────────────────────────────────────

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16)
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const weekday = (iso) => new Date(`${iso}T12:00:00`).getDay()

const stripMd = (s) =>
  s
    .replace(/\[\[[^\]|]*\\?\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\*\*/g, "")
    .trim()

function splitRow(line) {
  const cells = line.split(/(?<!\\)\|/)
  if (cells.length && cells[0].trim() === "") cells.shift()
  if (cells.length && cells[cells.length - 1].trim() === "") cells.pop()
  return cells.map((c) => c.trim())
}

const resolveYear = (mmdd) => (+mmdd.slice(0, 2) >= 8 ? `2026-${mmdd}` : `2027-${mmdd}`)
function dateTokens(text) {
  const out = []
  const re = /(\d{4}-\d{2}-\d{2})|\b(\d{2}-\d{2})\b/g
  let m
  while ((m = re.exec(text))) out.push(m[1] ?? resolveYear(m[2]))
  return out
}

async function safeList(dir) {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".md"))
  } catch {
    return []
  }
}

const stripFrontmatter = (md) => md.replace(/^---\n[\s\S]*?\n---\n/, "")
const fmTitle = (md) => md.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? ""

// ── content markdown+HTML → ManageBac-safe HTML ─────────────────────────────
// The content pages mix markdown with site components (pagebar, plates,
// stat-strips, contract cards, duecards, lesson rosters). ManageBac's editor
// keeps basic HTML (headings, p, lists, tables, a, strong/em, blockquote) and
// strips classed divs, so every component either becomes one of those or
// degrades to its text. Relative links and wikilinks become absolute site URLs.

const absUrl = (href) => {
  if (/^https?:/.test(href)) return href
  return `${SITE}/${href.replace(/^(\.\.\/)+/, "").replace(/^\//, "")}`
}

// Wraps a transform so one malformed component degrades to tag-stripped text
// rather than killing the page.
const safely = (fn, fallback) => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    // Inline tags sit tight against punctuation ("<em>A2</em>,"); stripping them
    // would otherwise leave "A2 ,".
    .replace(/\s+([.,;:!?)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .trim()
}

// Replace each `<div class="<name> …">` block via a balanced scan — the cards
// nest divs, which a non-greedy regex cannot bound (the contract card's foot
// links leaked through exactly that way).
function replaceDivBlocks(body, className, render) {
  const open = new RegExp(`<div class="${className}[^"]*">`)
  let guard = 0
  while (guard++ < 500) {
    const m = body.match(open)
    if (!m) break
    const start = m.index
    const tag = /<\/?div\b/g
    tag.lastIndex = start
    let depth = 0
    let end = -1
    let t
    while ((t = tag.exec(body))) {
      depth += t[0] === "</div" ? -1 : 1
      if (depth === 0) {
        end = body.indexOf(">", t.index) + 1
        break
      }
    }
    if (end <= 0) break
    const block = body.slice(start, end)
    body =
      body.slice(0, start) +
      safely(() => render(block), `<p>${stripTags(block)}</p>`) +
      body.slice(end)
  }
  return body
}

// Site components, matched on the emitted shapes in sync.mjs / at-a-glance.mjs /
// decks.mjs / course-map.mjs. Order matters: chrome first, then card → table.
function transformComponents(body) {
  // Self-check disclosures (<details class="reveal">): ManageBac strips
  // <details>, which would leave "Show answer" as stray text — make the answer
  // an explicit labeled line instead. These are self-marked practice questions;
  // the site keeps the interactive version.
  body = body.replace(
    /<details class="reveal"><summary>[^<]*<\/summary>([\s\S]*?)<\/details>/g,
    // stripTags leaves the answer as raw markdown, so run the inline pass over it
    // or "**low angle**" reaches ManageBac with its asterisks showing.
    (m, ans) => `<p><strong>Answer:</strong> ${inline(stripTags(ans))}</p>`,
  )

  // Pure chrome: progress bars, deck/credit links on the cards (decks are
  // attached natively to the unit's materials post instead).
  body = body.replace(/<svg[\s\S]*?<\/svg>/g, "")
  body = body.replace(/<a class="contract-(?:deck|credits)"[\s\S]*?<\/a>/g, "")
  body = replaceDivBlocks(body, "pagebar", () => "")
  body = replaceDivBlocks(body, "page-nav", () => "")

  // Figures: the images live on the password-gated site, so an inline <img> in
  // ManageBac would render as a broken plate for anyone without the cookie.
  // Keep the caption as a credit line linking out instead; the decks carry the
  // imagery natively.
  body = body.replace(/<figure[^>]*>[\s\S]*?<\/figure>/g, (fig) =>
    safely(() => {
      const src = fig.match(/src="([^"]+)"/)?.[1]
      const cap = fig.match(/<figcaption>([\s\S]*?)<\/figcaption>/)?.[1]
      if (!cap) return ""
      return `<p><em>Image: ${cap.trim()}${src ? ` — <a href="${absUrl(src)}">view</a>` : ""}</em></p>`
    }, ""),
  )
  body = replaceDivBlocks(body, "plate-row", (b) =>
    b.replace(/^<div[^>]*>/, "").replace(/<\/div>$/, ""),
  )

  // Stat strip (<dl class="stat-strip">): dt/dd pairs → a compact table.
  body = body.replace(/<dl class="stat-strip">[\s\S]*?<\/dl>/g, (dl) =>
    safely(() => {
      const rows = [...dl.matchAll(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)]
        .map(([, dt, dd]) => {
          const extra = dd.match(/<span class="stat-x">([\s\S]*?)<\/span>/)?.[1]
          const val = stripTags(dd.replace(/<span class="stat-x">[\s\S]*?<\/span>/, ""))
          return `<tr><td><strong>${stripTags(dt)}</strong></td><td>${val}${extra ? ` (${stripTags(extra)})` : ""}</td></tr>`
        })
        .join("")
      return `<table>${rows}</table>`
    }, stripTags(dl)),
  )

  // Lesson contract card: job line + labeled cells + homework → a table.
  body = replaceDivBlocks(body, "contract", (card) =>
    safely(() => {
      const rows = []
      const job = card.match(/<p class="contract-job">([\s\S]*?)<\/p>/)?.[1]
      const aos = [...card.matchAll(/<span class="contract-ao">([^<]+)<\/span>/g)].map((m) => m[1])
      if (job) rows.push(["Your job this lesson", `${stripTags(job)}${aos.length ? ` (${aos.join(", ")})` : ""}`])
      for (const [, label, value] of card.matchAll(
        /<span class="contract-cell-label">([\s\S]*?)<\/span><span class="contract-cell-value">([\s\S]*?)<\/span>/g,
      ))
        rows.push([stripTags(label), stripTags(value)])
      const hw = card.match(/<span class="contract-hw">[\s\S]*?<\/span>([\s\S]*?)<\/div>/)?.[1]
      if (hw && stripTags(hw)) rows.push(["Homework", stripTags(hw)])
      for (const [, line] of card.matchAll(
        /<span class="contract-line">([\s\S]*?)<\/span>\s*<\/span>/g,
      )) {
        const lab = line.match(/<span class="contract-line-label">([\s\S]*?)<\/span>([\s\S]*)/)
        if (lab) rows.push([stripTags(lab[1]), stripTags(lab[2])])
      }
      if (!rows.length) return `<p>${stripTags(card)}</p>`
      return `<table>${rows.map(([l, v]) => `<tr><td><strong>${l}</strong></td><td>${v}</td></tr>`).join("")}</table>`
    }, `<p>${stripTags(card)}</p>`),
  )

  // Due-date card: item/date/what rows → a table.
  body = replaceDivBlocks(body, "duecard", (card) =>
    safely(() => {
      const rows = [...card.matchAll(/<div class="duecard-row">([\s\S]*?)<\/div>/g)]
        .map(([, row]) => {
          const item = stripTags(row.match(/<span class="duecard-item">([\s\S]*?)<\/span>/)?.[1] ?? "")
          const date = stripTags(row.match(/<span class="duecard-date">([\s\S]*?)<\/span>/)?.[1] ?? "")
          const what = stripTags(
            (row.match(/<span class="duecard-what">([\s\S]*?)$/)?.[1] ?? "").replace(
              /<span class="duecard-ao">/,
              " — ",
            ),
          )
          return `<tr><td><strong>${item}</strong></td><td>${date}</td><td>${what}</td></tr>`
        })
        .join("")
      return `<table><tr><th>Item</th><th>Due</th><th>What</th></tr>${rows}</table>`
    }, `<p>${stripTags(card)}</p>`),
  )

  // Unit lesson roster: rows → a linked list.
  body = replaceDivBlocks(body, "unit-lessons", (roster) =>
    safely(() => {
      const items = [...roster.matchAll(/<div class="ul-row">([\s\S]*?)(?=<div class="ul-row">|$)/g)]
        .map(([, row]) => {
          const num = stripTags(row.match(/<span class="ul-num">([\s\S]*?)<\/span>/)?.[1] ?? "")
          const title = row.match(/<a class="ul-title" href="([^"]+)">([\s\S]*?)<\/a>/)
          const meta = stripTags(row.match(/<span class="ul-meta">([\s\S]*?)<\/span>/)?.[1] ?? "")
          const desc = stripTags(row.match(/<span class="ul-desc">([\s\S]*?)<\/span>/)?.[1] ?? "")
          const head = title
            ? `<a href="${absUrl(title[1])}">${num} ${stripTags(title[2])}</a>`
            : num
          return `<li><strong>${head}</strong> ${meta}${desc ? ` — ${desc}` : ""}</li>`
        })
        .join("")
      return `<ul>${items}</ul>`
    }, `<p>${stripTags(roster)}</p>`),
  )

  // Handout download lines keep their text but need absolute hrefs (handled by
  // the global pass below). Any remaining classed wrappers unwrap.
  body = body.replace(/<\/?(?:div|span|dl|dt|dd|details|summary)\b[^>]*>/g, "")

  // Absolute-ify every surviving relative href/src, then drop class attributes —
  // they mean nothing off the site, and ManageBac's sanitizer chokes less on
  // plain tags.
  body = body.replace(/(href|src)="((?:\.\.\/)+[^"]+)"/g, (m, attr, path) => `${attr}="${absUrl(path)}"`)
  body = body.replace(/ class="[^"]*"/g, "")
  return body
}

// Line-based markdown → HTML for what the content pages actually use: ATX
// headings, lists, tables, blockquotes, hr, paragraphs. Inline: bold, italics,
// links, wikilinks, code. Lines that are already HTML pass through.
function inline(text) {
  return text
    .replace(/\[\[([^\]|\\]+)\\?\|([^\]]+)\]\]/g, (m, path, label) => `<a href="${SITE}/${path}">${label}</a>`)
    .replace(/\[\[([^\]]+)\]\]/g, (m, path) => `<a href="${SITE}/${path}">${basename(path)}</a>`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, href) => `<a href="${absUrl(href)}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(>])\*([^*\n]+)\*(?=[\s).,;:!?<]|$)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
}

function mdToHtml(md) {
  const out = []
  const lines = md.split("\n")
  let i = 0
  const isHtml = (l) => /^\s*<\/?[a-zA-Z]/.test(l)
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (isHtml(line)) {
      out.push(line)
      i++
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)/)
    if (h) {
      const level = Math.min(h[1].length + 1, 5) // page h1 → h2 etc.; MB bodies sit under their own title
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      i++
      continue
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push("<hr />")
      i++
      continue
    }
    if (line.startsWith("|")) {
      const rows = []
      while (i < lines.length && lines[i].startsWith("|")) rows.push(splitRow(lines[i++]))
      // The separator row must actually contain dashes: an empty header row
      // ("| | |", which several At-a-glance tables open with) otherwise matches
      // and the real "---" row then renders as data.
      const sep = rows.findIndex(
        (r) => r.some((c) => /^:?-{2,}:?$/.test(c)) && r.every((c) => /^:?-{2,}:?$/.test(c) || c === ""),
      )
      const head = sep > 0 ? rows.slice(0, sep) : []
      const bodyRows = sep >= 0 ? rows.slice(sep + 1) : rows
      const tr = (cells, tag) => `<tr>${cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join("")}</tr>`
      out.push(
        `<table>${head.map((r) => tr(r, "th")).join("")}${bodyRows.map((r) => tr(r, "td")).join("")}</table>`,
      )
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""))
      const tag = ordered ? "ol" : "ul"
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</${tag}>`)
      continue
    }
    if (line.startsWith(">")) {
      const quote = []
      while (i < lines.length && lines[i].startsWith(">"))
        quote.push(lines[i++].replace(/^>\s?/, ""))
      out.push(`<blockquote><p>${inline(quote.join(" ").replace(/\[!\w+\]\s*/, ""))}</p></blockquote>`)
      continue
    }
    const para = []
    while (i < lines.length && lines[i].trim() && !isHtml(lines[i]) && !/^([#>|]|\s*([-*]|\d+\.)\s)/.test(lines[i]))
      para.push(lines[i++])
    out.push(`<p>${inline(para.join(" "))}</p>`)
  }
  return out.join("\n")
}

function mbHtml(md) {
  // A handful of source cells carry an unpaired ** that inline() cannot match
  // (an opener flattened out of a card, a stray closer). By this point every
  // legitimate pair is already <strong>, so anything left is literal asterisks
  // that would reach ManageBac as visible junk.
  return transformComponents(mdToHtml(transformComponents(stripFrontmatter(md)))).replace(/\*\*/g, "")
}

// The page's own lead heading duplicates the ManageBac object's title field —
// drop the first h2 (the demoted page h1) from bodies that sit under a title.
const dropLeadHeading = (html) => html.replace(/<h2>[^<]*<\/h2>\s*/, "")

// ── Registers → task rows ────────────────────────────────────────────────────
// Richer than course-events.mjs's parser: keeps every column with its header
// label (the task body renders them as a table), and matches SB codes, which
// PAL's register carries and the calendar never needed.

const CODE_RE = /^(A[1-6]|EoT|CS\d+|HW\d+|SB\d+|LB\d+)$/

function parseRegisterRich(md, href, { includeLB = false } = {}) {
  const rows = []
  const undated = []
  let headers = null
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue
    const cells = splitRow(line)
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue
    if (/^(code|item)$/i.test(stripMd(cells[0] ?? ""))) {
      headers = cells.map(stripMd)
      continue
    }
    const first = stripMd(cells[0] ?? "")
    const code = first.match(CODE_RE)?.[1]
    if (!code || !headers) continue
    // Learning Behaviour is Doğan's own layer on the A-Level side, decided and
    // recorded in class rather than posted as ManageBac tasks (his instruction,
    // 2026-08-29). The AP scheme has no Learning Behaviour category at all: the
    // postings are graded Minors work there, so that pack opts in and loads them.
    if (code.startsWith("LB") && !includeLB) continue
    const fields = {}
    headers.slice(1).forEach((h, idx) => {
      const v = cells[idx + 1]
      if (v) fields[h] = v
    })
    const dateCell = cells[1] ?? ""
    const dates = dateTokens(dateCell)
    const codeLink = (cells[0].match(/\[\[([^\]|\\]+)\\?\|/) ?? [])[1] ?? null
    if (!dates.length) {
      undated.push({ code, fields, href, page: codeLink })
      continue
    }
    rows.push({
      code,
      // Spanned "set → due" rows: the due date is what students act on. An exam
      // *window* is the opposite — be ready when it opens, the office sets the slot.
      due: /window/i.test(dateCell) ? dates[0] : dates[dates.length - 1],
      fields,
      href,
      page: codeLink, // per-code assessment page, when the register links one
    })
  }
  return { rows, undated }
}

// ManageBac's own category labels (recon 2026-08-26): Attainment / Course
// Skills / Learning Behavior / Final, weighted 50/20/10/20 in all four CAIE
// classes. US spelling and "Final" are ManageBac's, not ours.
const CATEGORY = (code) =>
  /^A\d/.test(code)
    ? "Attainment"
    : code === "EoT"
      ? "Final"
      : code.startsWith("LB")
        ? "Learning Behavior"
        : "Course Skills" // CS, HW, SB

// ── Decks and handouts → attachments ─────────────────────────────────────────

const LESSON_KEY = /(s\d+-lesson-(\d+))-.+$/
const COURSE_KEY = /(?:^|-)(intro-\d+|s\d+-a(\d+))-(.+)$/

async function courseDecks(course) {
  const folder = basename(course.dir)
  const dir = join(CONTENT, "decks", folder)
  const out = []
  let entries
  try {
    entries = await readdir(dir)
  } catch {
    return out
  }
  for (const file of entries) {
    if (!file.endsWith(".pptx")) continue
    const stem = file.replace(/\.pptx$/, "")
    const lesson = stem.match(LESSON_KEY)
    const courseDeck = stem.match(COURSE_KEY)
    out.push({
      path: join(dir, file),
      file,
      lesson: lesson ? +lesson[2] : null,
      intro: courseDeck && !courseDeck[2] ? true : false,
      attainment: courseDeck?.[2] ? +courseDeck[2] : null,
      bytes: (await stat(join(dir, file))).size,
    })
  }
  return out
}

// ── Per-course pack assembly ─────────────────────────────────────────────────

async function buildCourse(key) {
  const cfg = LOAD[key]
  const course = COURSES[cfg.base ?? key]
  const mapCat = (c) => cfg.categoryMap?.[c] ?? c
  // Some packs need to split one source category across two destinations —
  // the AP gradebook files the boards as Performance Tasks and the essays as
  // Assessments, though both are Attainment here. Per-code wins when set.
  const catFor = (code) => cfg.categoryByCode?.[code] ?? mapCat(CATEGORY(code))
  const dir = course.dir // "classes/<course-folder>"
  const root = join(CONTENT, dir)
  const notes = []

  // Dates, lessons, unit spans — reuse of the calendar's parser, against the vault.
  const detail = await courseDetailEvents(VAULT, dir)

  // Registers, richly parsed for task bodies. S1 register only: later-semester
  // registers (9479 S2–S4) load in their own semester.
  const tasks = []
  const undatedAll = []
  for (const f of await safeList(join(root, "assessments"))) {
    if (!/s1-assessments/.test(f)) continue
    const md = await readFile(join(root, "assessments", f), "utf8")
    const { rows, undated } = parseRegisterRich(md, `${dir}/assessments/${f.replace(/\.md$/, "")}`, {
      includeLB: !!cfg.includeLB,
    })
    undatedAll.push(...undated)
    for (const row of rows) tasks.push(row)
  }
  // Graded items the register carries as prose sections rather than table rows.
  for (const extra of cfg.extraTasks ?? []) {
    if (extra.due) tasks.push({ code: extra.code, due: extra.due, fields: {}, href: extra.page, page: extra.page })
    else undatedAll.push({ code: extra.code, fields: {}, href: extra.page, page: extra.page })
  }

  // Unit pages: number → { file, title, md }.
  const units = new Map()
  for (const f of await safeList(join(root, "unit-plans"))) {
    const um = f.match(/s1-unit-(\d)/)
    if (!um) continue
    const md = await readFile(join(root, "unit-plans", f), "utf8")
    units.set(+um[1], { file: f, href: `${dir}/unit-plans/${f.replace(/\.md$/, "")}`, md, title: fmTitle(md) })
  }

  // Lesson pages: number → file/md; unit membership from the calendar parser.
  // `md` is the site body (student-facing, already reframed); `vaultMd` is the
  // vault original, which is the only copy that still carries the At-a-glance
  // table — sync.mjs replaces it with the contract card on the way out, so
  // session dates have to be read from the vault side.
  const lessons = new Map()
  for (const f of await safeList(join(root, "lesson-plans"))) {
    const lm = f.match(/s1-lesson-(\d+)/)
    if (!lm) continue
    let vaultMd = ""
    try {
      vaultMd = await readFile(join(VAULT, dir, "lesson-plans", f), "utf8")
    } catch {}
    lessons.set(+lm[1], {
      file: f,
      href: `${dir}/lesson-plans/${f.replace(/\.md$/, "")}`,
      md: await readFile(join(root, "lesson-plans", f), "utf8"),
      vaultMd,
    })
  }
  const lessonUnit = new Map()
  for (const ev of detail.events)
    if (ev.kind === "lesson" && ev.unit) {
      const n = +(ev.code.match(/L(\d+)/)?.[1] ?? 0)
      if (n) lessonUnit.set(n, ev.unit)
    }

  const unitSpan = new Map(detail.units.map((u) => [u.num, u]))
  const unitFor = (date) =>
    detail.units.find((u) => date >= u.start && date <= u.end)?.num ?? null

  // Attainment task bodies from their per-code pages.
  const taskObjects = []
  // The AP section abbreviates nothing: Major N and Minor N numbered by date
  // across the semester, and Final. Computed from the register rather than
  // hard-coded, so a moved date renumbers itself. The vault keeps A1–A4 etc.
  const codeLabel = {}
  if (cfg.spellOutCodes) {
    let major = 0
    let minor = 0
    for (const t of [...tasks].sort((a, b) => (a.due < b.due ? -1 : 1))) {
      if (t.code === "EoT") codeLabel[t.code] = "Final"
      else if (/^A\d/.test(t.code)) codeLabel[t.code] = `Major ${++major}`
      else codeLabel[t.code] = `Minor ${++minor}`
    }
  }

  // The AP Minors band numbers by date across every posting, the Learning
  // Behaviour ones included. Doğan writes those himself (his instruction, held
  // to on 2026-08-29), so they are numbered here and not published: the gaps at
  // Minor 2, 3, 6, 7, 8, 10, 11, 13 and 14 are the slots his postings take, and
  // the band stays in date order once he fills them. This also keeps the two
  // Art Appreciation classes carrying the same number of my assignments.
  const emitted =
    cfg.emitLB === false ? tasks.filter((t) => !t.code.startsWith("LB")) : tasks

  for (const t of emitted.sort((a, b) => (a.due < b.due ? -1 : 1))) {
    let html = null
    let title = null
    let siteLink = `${SITE}/${t.href}`
    if (t.page) {
      try {
        const md = await readFile(join(CONTENT, `${t.page}.md`), "utf8")
        html = dropLeadHeading(mbHtml(md))
        title = fmTitle(md).replace(/^.*?S1\s+/, "") // "Media Studies · S1 A1: X" → "A1: X"
        siteLink = `${SITE}/${t.page}`
      } catch {
        notes.push(`register links ${t.page} but the page is missing; fell back to the row`)
      }
    }
    let fromRow = false
    if (!html) {
      fromRow = true
      const rows = Object.entries(t.fields)
        .map(([label, v]) => `<tr><td><strong>${esc(label)}</strong></td><td>${inline(v)}</td></tr>`)
        .join("")
      html = `<table>${rows}</table>\n<p>Full register: <a href="${SITE}/${t.href}">${course.name} S1 assessments</a></p>`
      const desc = stripMd(Object.values(t.fields)[1] ?? Object.values(t.fields)[0] ?? "")
      title = `${t.code} · ${desc.split(/[.;(]/)[0].trim()}`
    }
    // The two title routes name the item differently. A brief's own title leads
    // with the code spelled its own way — "A1: The Unit 1 Board", but also
    // "End of Term: The Retrospective" — so swap everything before the colon.
    // The row fallback was built from t.code, so match that literally. Doing
    // the colon swap on a fallback title would eat a legitimate inner colon
    // ("Minor 6 · U3 seminar: food, class…").
    const label = codeLabel[t.code]
    if (label && title) {
      const colon = title.indexOf(":")
      title =
        !fromRow && colon > -1
          ? `${label}:${title.slice(colon + 1)}`
          : title.replace(new RegExp(`^${t.code}\\b`), label)
    }
    taskObjects.push({
      id: `${key}/task/${t.code}`,
      kind: "task",
      code: t.code,
      title,
      category: catFor(t.code),
      due: t.due,
      dueTime: cfg.times[weekday(t.due)] ?? "08:00",
      unitRef: unitFor(t.due),
      // ManageBac requires Max Points when the Points assessment option is on.
      // Register-stated totals override; 100 is the load default, flagged in the
      // pack for Doğan's review.
      maxPoints: cfg.points?.[t.code] ?? 100,
      // Whether to enable Coursework Submissions (online upload). In-class sits
      // stay off; posted/uploaded work goes on.
      submission: /post|upload|submit|blog|portfolio|series|sketchbook|photograph/i.test(
        stripTags(html),
      ),
      html,
      text: stripTags(html),
      attachments: [],
      siteLink,
    })
  }

  // PAL's weekly Learning Behaviour postings, synthesized from session dates.

  // Lesson objects: one per vault lesson, carrying its own body and sitting
  // under the unit the calendar parser assigned it. Start and end are the first
  // and last session of that lesson, timed from the course's timetable slot.
  const lessonObjects = []
  for (const [n, l] of [...lessons.entries()].sort((a, b) => a[0] - b[0])) {
    const unitRef = lessonUnit.get(n) ?? null
    const off = cfg.offGrid?.[n] ?? null
    const { dates: parsed, raw } = lessonSessions(l.vaultMd || l.md, cfg.sessions ?? {})
    const dates = off ?? parsed
    const code = `L${String(n).padStart(2, "0")}`
    const title = fmTitle(l.md).replace(/^.*?Lesson \d+:\s*/, "")
    if (!unitRef) notes.push(`${code} has no unit in the calendar parse; not loadable`)
    if (!dates.length) notes.push(`${code} "${raw ?? "no Dates row"}" yielded no session date; loads undated`)
    if (off) notes.push(`${code} loads off-grid (${off.join(", ")}), date-only: no timetabled period`)
    const first = dates[0] ?? null
    const last = dates[dates.length - 1] ?? null
    // Off-grid days carry no period, so they load with a date and no time.
    const slot = (iso) => (off || !iso ? null : (cfg.sessions ?? {})[weekday(iso)])
    const dayList = dates.map((d) => `${WEEKDAY[weekday(d)]} ${d}`).join(" · ")
    let html = dates.length
      ? `<p><strong>${dates.length === 1 ? "Session" : `${dates.length} sessions`}:</strong> ${dayList}</p>\n`
      : ""
    // Decided 2026-08-29: the lesson carries its whole page and the unit carries
    // only its own overview, so nothing is said twice. The hero image does not
    // travel into ManageBac, so its credit line goes with it.
    // Every plate lives on the password-gated site, so its credit line is a dead
    // pointer inside ManageBac. The decks carry the imagery natively.
    html += dropLeadHeading(mbHtml(l.md)).replace(/<p><em>Image:[\s\S]*?<\/em><\/p>\n?/g, "")
    html += `\n<p><em>Always current on the course site: <a href="${SITE}/${l.href}">${esc(fmTitle(l.md))}</a></em></p>`
    lessonObjects.push({
      id: `${key}/lesson/${n}`,
      kind: "lesson",
      num: n,
      code,
      unitRef,
      title: `${code} · ${title}`,
      sessionDates: dates,
      startDate: first,
      endDate: last,
      startTime: slot(first)?.[0] ?? null,
      endTime: slot(last)?.[1] ?? null,
      html,
      text: stripTags(html),
      attachments: [],
      siteLink: `${SITE}/${l.href}`,
    })
  }

  // Unit objects: shell fields + full composed content (unit body, then each
  // lesson's full body under its own heading).
  const decks = await courseDecks(course)
  // Each task links to the lesson it is set or sat in, so ManageBac's "Lesson
  // Experience" field points at the session rather than being left blank. A task
  // belongs to the lesson whose own session days contain its due date; where a
  // due date falls outside every lesson (a break deadline, an exam-window sit)
  // it takes the nearest lesson at or before it, which is the session the class
  // was last told about it.
  const byDate = new Map()
  for (const l of lessonObjects) for (const d of l.sessionDates) byDate.set(d, l)
  const lessonDays = [...byDate.keys()].sort()
  for (const t of taskObjects) {
    if (!t.due) continue
    let hit = byDate.get(t.due)
    if (!hit) {
      const prior = lessonDays.filter((d) => d <= t.due).pop()
      hit = prior ? byDate.get(prior) : null
    }
    if (hit) {
      t.lessonRef = hit.num
      t.lessonTitle = hit.title
      t.lessonExact = byDate.has(t.due)
    } else notes.push(`${t.code} has no lesson to attach to (due ${t.due})`)
  }

  const unitObjects = []
  const streamObjects = []
  for (const [num, u] of [...units.entries()].sort((a, b) => a[0] - b[0])) {
    const span = unitSpan.get(num)
    const lessonNums = [...lessonUnit.entries()]
      .filter(([, un]) => un === num)
      .map(([n]) => n)
      .sort((a, b) => a - b)
    // The unit description is the unit's own overview. Each lesson's full text
    // lives on its own lesson object under this unit (decided 2026-08-29), so
    // the unit page names the sequence rather than repeating it.
    let html = dropLeadHeading(mbHtml(u.md)).replace(/<p><em>Image:[\s\S]*?<\/em><\/p>\n?/g, "")
    if (lessonNums.length) {
      const items = lessonNums
        .map((n) => {
          const l = lessons.get(n)
          return l ? `<li>${esc(fmTitle(l.md))}</li>` : null
        })
        .filter(Boolean)
      html += `\n<hr />\n<p><strong>Lessons in this unit</strong> (each one is a lesson below, with its own dates, plan and assessment):</p>\n<ol>${items.join("")}</ol>`
    }
    html += `\n<p><em>Always current on the course site: <a href="${SITE}/${u.href}">${esc(u.title)}</a></em></p>`
    // Shell description: the first real paragraph of the unit body (not the
    // image credit line, not the concept chips).
    // Shell description: the unit's first real paragraph. Callouts render as
    // blockquotes and often lead the page (a winter-break warning, a contingency
    // note), so they are excluded along with the image credit and concept chips.
    const summaryMatch = [
      [...mbHtml(u.md).replace(/<blockquote>[\s\S]*?<\/blockquote>/g, "").matchAll(/<p>([\s\S]*?)<\/p>/g)]
        .map((m) => stripTags(m[1]))
        .find((t) => t.length > 40 && !/^(Image:|Concepts:)/.test(t)) ?? "",
    ]
    // ManageBac's unit timeline is not a date range. It stores a start month, a
    // week-within-month, and a duration in weeks, and it draws **every month as
    // exactly four week-slots** (the week selector offers 1 to 4 and nothing
    // else). Both ends have to be expressed on that grid, or the bar drifts.
    //
    // ⚠ Days 29 to 31 belong to the fourth slot, not a fifth. `Math.ceil(d / 7)`
    // returns 5 for them, which the selector cannot represent; a unit starting
    // late in a month would have sent an unsettable value. Corrected 2026-08-30.
    //
    // Duration is measured on the same grid rather than in real calendar weeks.
    // Mixing the two is what made six units draw a week long or a week short:
    // a real week is 1/4.35 of a month here, not 1/4.
    const MB_MONTHS = "January February March April May June July August September October November December".split(" ")
    const startSlot = span ? mbSlotOf(span.start) : null
    const weeks = span ? Math.max(1, mbSlotOf(span.end) - startSlot + 1) : null
    unitObjects.push({
      id: `${key}/unit/${num}`,
      kind: "unit",
      num,
      title: u.title,
      startDate: span?.start ?? null,
      endDate: span?.end ?? null,
      durationWeeks: weeks,
      mbStartMonth: span ? MB_MONTHS[+span.start.slice(5, 7) - 1] : null,
      mbStartWeek: startSlot === null ? null : (startSlot % 4) + 1,
      summary: summaryMatch?.[0] ?? "",
      html,
      text: stripTags(html),
      attachments: [],
      siteLink: `${SITE}/${u.href}`,
    })

    // Materials post: decks whose lesson sits in this unit, intro decks on U1,
    // per-attainment briefs on the unit their attainment closes, handouts by map.
    const att = []
    for (const d of decks) {
      const belongs =
        (d.lesson && lessonUnit.get(d.lesson) === num) ||
        (d.intro && num === 1) ||
        (d.attainment &&
          unitFor(taskObjects.find((t) => t.code === `A${d.attainment}`)?.due ?? "") === num)
      if (belongs) att.push(d.path)
    }
    if (cfg.handoutUnits) {
      const hdir = join(HANDOUTS_DIR, basename(course.dir))
      let hfiles = []
      try {
        hfiles = (await readdir(hdir)).filter((f) => f.endsWith(".pdf"))
      } catch {}
      for (const f of hfiles) {
        const unit = cfg.handoutUnits[f.replace(/\.pdf$/, "")] ?? cfg.handoutUnits["*"]
        if (unit === num) att.push(join(hdir, f))
      }
    }
    if (att.length) {
      // ManageBac's Add Files dialog takes at most 10 files per post, so a unit
      // that carries more splits in two: the slide decks, then the readings.
      // Art Appreciation U3 is the only one that trips this (4 decks + 9 PDFs).
      const groups =
        att.length > 10
          ? [
              { suffix: "materials", label: "Slides", files: att.filter((p) => p.endsWith(".pptx")) },
              { suffix: "readings", label: "Readings", files: att.filter((p) => !p.endsWith(".pptx")) },
            ].filter((g) => g.files.length)
          : [{ suffix: "materials", label: "Slides and materials", files: att }]
      if (groups.some((g) => g.files.length > 10))
        notes.push(`unit ${num} still exceeds the 10-file limit after splitting; split it by hand`)
      for (const g of groups) {
        const list = await Promise.all(
          g.files.map(async (p) => `<li>${esc(basename(p))} (${kb((await stat(p)).size)})</li>`),
        )
        streamObjects.push({
          id: `${key}/stream/unit-${num}${g.suffix === "readings" ? "-readings" : ""}`,
          kind: "stream",
          title: `Unit ${num} ${g.suffix} · ${u.title.replace(/^Unit \d+:\s*/, "")}`,
          unitRef: num,
          postAfter: span?.start ?? null, // the date stamped on the post; ManageBac cannot schedule
          html: `<p>${g.label} for <a href="${SITE}/${u.href}">${esc(u.title)}</a>:</p>\n<ul>${list.join("")}</ul>`,
          text: `${g.label} for ${u.title}`,
          attachments: g.files,
          siteLink: `${SITE}/${u.href}`,
        })
      }
    }
  }

  // Consecutive units that end and begin inside the same seven-day slot share
  // that slot on the unit calendar, and the bars overlap. This is not a data
  // error: at one-week resolution it is a true statement about the week. Named
  // here so it stays a known property rather than a mystery in the Year view.
  {
    const seq = [...unitObjects].sort((a, b) => a.num - b.num)
    for (let i = 1; i < seq.length; i++) {
      const prevEnd = mbSlotOf(seq[i - 1].startDate) + seq[i - 1].durationWeeks - 1
      if (mbSlotOf(seq[i].startDate) <= prevEnd)
        notes.push(
          `units ${seq[i - 1].num} and ${seq[i].num} share a week slot on the unit calendar ` +
            `(${seq[i - 1].endDate} → ${seq[i].startDate} falls inside one week); the bars will overlap`,
        )
    }
  }

  // The C1 study guide (media): print the interactive HTML to PDF once, then
  // attach to A3 and the U2 materials post.
  if (cfg.guidePdf) {
    const src = join(HANDOUTS_DIR, cfg.guidePdf.source)
    const pdf = join(PACKS, key, basename(cfg.guidePdf.source).replace(/\.html$/, ".pdf"))
    try {
      await stat(pdf)
    } catch {
      await mkdir(join(PACKS, key), { recursive: true })
      try {
        await run(CHROME, ["--headless", "--disable-gpu", `--print-to-pdf=${pdf}`, src], {
          timeout: 60_000,
        })
      } catch (e) {
        notes.push(`C1 guide PDF conversion failed (${e.message.split("\n")[0]}); attach manually`)
      }
    }
    try {
      await stat(pdf)
      for (const target of cfg.guidePdf.attachTo) {
        const [kind, ref] = target.split(":")
        const obj =
          kind === "task"
            ? taskObjects.find((t) => t.code === ref)
            : streamObjects.find((s) => s.unitRef === +ref)
        if (obj) obj.attachments.push(pdf)
        else notes.push(`guide attach target ${target} not found`)
      }
    } catch {}
  }

  // Load order: tasks by date, then unit shells, then full-content units and
  // posts — matching the wave structure (spine first).
  const objects = [...taskObjects, ...unitObjects, ...lessonObjects, ...streamObjects].map((o) => ({
    ...o,
    // The hash has to cover every field a load actually sets, or --diff reports
    // "changed: none" while the platform holds something else. It missed the
    // unit timeline until 2026-08-30, so six units drew the wrong length and the
    // ledger called them in sync; a task's category, points and lesson link were
    // invisible the same way.
    hash: sha(
      [
        o.title,
        o.due ?? "",
        o.html,
        o.category ?? "",
        o.maxPoints ?? "",
        o.lessonRef ?? "",
        o.mbStartMonth ?? "",
        o.mbStartWeek ?? "",
        o.durationWeeks ?? "",
        ...(o.attachments ?? []).map((a) => basename(a)),
      ].join(" "),
    ),
  }))

  return { key, course, objects, undated: undatedAll, notes }
}




// ManageBac's unit calendar grid: four week-slots per month, days 29 to 31 in
// the fourth. Shared by the unit builder and the overlap check.
const mbSlotOf = (iso) => {
  const [y, m, d] = iso.split("-").map(Number)
  return y * 48 + (m - 1) * 4 + Math.min(3, Math.floor((d - 1) / 7))
}

// ── Lesson session dates ─────────────────────────────────────────────────────
// The `Dates` row of a lesson's At-a-glance table is written for a human and
// comes in three shapes across the four courses:
//
//   list   Mon 2026-09-07 · Wed 09-09 · Thu 09-10 · Fri 09-11     (media, 9479)
//   range  Fri 2026-09-04 to Fri 2026-09-11                       (art appreciation)
//   single Wed 2026-09-02                                         (PAL)
//
// Short forms inherit the last stated year. A range is expanded across the
// course's own teaching weekdays, so a Mon-to-Fri span for Art Appreciation
// yields Mon, Tue, Wed, Fri and never a Thursday it does not teach. Days the
// course does not teach are dropped either way, which also removes the two
// make-up days whose timetable is still TBC.
// School-wide closures from [[shared/school-academic-calendar]]. Only the days
// the whole school is shut: the two cohort-specific blocks (G11 Juniors Days,
// G12 Seniors' Days) are deliberately absent, because teaching continues on
// them for every other grade and the plans that are affected already say so in
// their own Dates row (Art Appreciation L07 is built for Seniors' Day week).
const CLOSED = [
  ["2026-09-25", "2026-09-27"], // Mid-Autumn Festival
  ["2026-10-01", "2026-10-07"], // National Day
  ["2026-12-24", "2027-01-03"], // Winter break, continuous, confirmed 2026-07-19
]
const closed = (iso) => CLOSED.some(([s, e]) => iso >= s && iso <= e)

function lessonSessions(md, sessions) {
  const row = md.match(/^\|\s*Dates\s*\|([^\n]*)\|/m)?.[1]
  if (!row) return { dates: [], raw: null }
  const teaches = (iso) => sessions[new Date(`${iso}T12:00:00`).getDay()] != null && !closed(iso)

  const found = []
  let year = null
  for (const m of row.matchAll(/(\d{4})-(\d{2})-(\d{2})|(?<![\d-])(\d{2})-(\d{2})(?![\d-])/g)) {
    if (m[1]) {
      year = m[1]
      found.push(`${m[1]}-${m[2]}-${m[3]}`)
    } else if (year) {
      found.push(`${year}-${m[4]}-${m[5]}`)
    }
  }
  if (!found.length) return { dates: [], raw: row.trim() }

  // Parentheticals carry exclusions, not sessions: "(G11 out Wed 11-04 to Fri
  // 11-06)", "(no class Fri 11-27, Seniors' Day)". They are cut from the range
  // before it is expanded, then applied as removals.
  const main = row.replace(/\([^)]*\)/g, " ") // strip parentheticals, keep what follows
  const mainDates = found.filter((iso) => main.includes(iso.slice(5)) || main.includes(iso))

  let dates
  if (/\bto\b/.test(main) && mainDates.length >= 2) {
    // Range: walk day by day and keep the ones this course actually meets.
    dates = []
    const end = new Date(`${mainDates[mainDates.length - 1]}T12:00:00`)
    for (const d = new Date(`${mainDates[0]}T12:00:00`); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10)
      if (teaches(iso)) dates.push(iso)
    }
  } else {
    dates = [...new Set(mainDates.length ? mainDates : found)].filter(teaches).sort()
  }

  for (const paren of row.match(/\(([^)]*)\)/g) ?? []) {
    const inner = found.filter((iso) => paren.includes(iso.slice(5)) || paren.includes(iso))
    if (!inner.length) continue
    const drop = new Set(inner)
    if (/\bto\b/.test(paren) && inner.length >= 2)
      for (const d = new Date(`${inner[0]}T12:00:00`); d <= new Date(`${inner[inner.length - 1]}T12:00:00`); d.setDate(d.getDate() + 1))
        drop.add(d.toISOString().slice(0, 10))
    dates = dates.filter((iso) => !drop.has(iso))
  }
  return { dates, raw: row.trim() }
}

// ── Pack rendering ───────────────────────────────────────────────────────────

function packHtml({ key, course, objects, undated, notes }) {
  const badge = (o) =>
    o.kind === "task"
      ? `${o.category} · due ${WEEKDAY[weekday(o.due)]} ${o.due} ${o.dueTime} · ${o.maxPoints} pts · ${o.submission ? "online submission" : "no submission"}`
      : o.kind === "unit"
        ? `Unit · ${o.startDate ?? "?"} → ${o.endDate ?? "?"} · MB: ${o.mbStartMonth ?? "?"} W${o.mbStartWeek ?? "?"} · ${o.durationWeeks ?? "?"} wk`
        : o.kind === "lesson"
          ? `Lesson · unit ${o.unitRef ?? "?"} · ${o.sessionDates.length} session${o.sessionDates.length === 1 ? "" : "s"} · ${o.startDate ?? "?"} ${o.startTime ?? ""} → ${o.endDate ?? "?"} ${o.endTime ?? ""}`
          : `Stream post · after ${o.postAfter ?? "unit start"}`
  const section = (o) => `
<section style="border:1px solid #bbb;margin:1.5rem 0;padding:0 1rem 1rem">
<p style="background:#eee;margin:0 -1rem;padding:.4rem 1rem"><strong>${esc(o.id)}</strong> — ${badge(o)}${
    o.attachments.length ? ` · 📎 ${o.attachments.map((a) => esc(basename(a))).join(", ")}` : ""
  }</p>
<h3>${esc(o.title)}</h3>
${o.html}
</section>`
  const counts = ["task", "unit", "lesson", "stream"].map(
    (k) => `${objects.filter((o) => o.kind === k).length} ${k}s`,
  )
  return `<!doctype html><meta charset="utf-8">
<title>ManageBac pack · ${esc(course.name)}</title>
<body style="max-width:60rem;margin:2rem auto;font-family:Georgia,serif;line-height:1.5">
<h1>ManageBac load pack · ${esc(course.name)}</h1>
<p>${counts.join(" · ")} · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")}</p>
${notes.length ? `<p style="color:#a00"><strong>Notes:</strong></p><ul style="color:#a00">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
${
  undated.length
    ? `<p style="color:#a00"><strong>Not created (no date in the register):</strong> ${undated
        .map((u) => u.code)
        .join(", ")} — decide dates before or during the load.</p>`
    : ""
}
${objects.map(section).join("\n")}
</body>`
}

// ── Diff against load state ──────────────────────────────────────────────────

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"))
  } catch {
    return {}
  }
}

function diffReport(state, built) {
  // The ledger nests its rows under `objects`, alongside `_classes` and the
  // `_notes` a human writes; older flat files are still read as-is.
  const rows = state.objects ?? state
  const lines = []
  for (const { key, objects } of built) {
    const fresh = []
    const changed = []
    for (const o of objects) {
      const s = rows[o.id]
      if (!s) fresh.push(o.id)
      else if (s.hash !== o.hash) changed.push(o.id)
    }
    const known = new Set(objects.map((o) => o.id))
    const orphaned = Object.keys(rows).filter((id) => id.startsWith(`${key}/`) && !known.has(id))
    lines.push(`\n${COURSES[LOAD[key].base ?? key].name}${LOAD[key].base ? " (HS section)" : ""}:`)
    lines.push(`  new: ${fresh.length ? fresh.join(", ") : "none"}`)
    lines.push(`  changed: ${changed.length ? changed.join(", ") : "none"}`)
    if (orphaned.length) lines.push(`  in state but no longer generated: ${orphaned.join(", ")}`)
  }
  return lines.join("\n")
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const only = args.includes("--course") ? args[args.indexOf("--course") + 1] : null
const keys = only ? [only] : TAUGHT
if (only && !LOAD[only]) {
  console.error(`unknown course key ${only}; expected one of ${TAUGHT.join(", ")}`)
  process.exit(1)
}

const built = []
for (const key of keys) built.push(await buildCourse(key))

if (args.includes("--diff")) {
  console.log(diffReport(await loadState(), built))
} else {
  for (const pack of built) {
    const dir = join(PACKS, pack.key)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify(
        { course: pack.course.name, generated: new Date().toISOString(), objects: pack.objects },
        null,
        2,
      ),
    )
    await writeFile(join(dir, "pack.html"), packHtml(pack))
    const t = pack.objects.filter((o) => o.kind === "task").length
    const u = pack.objects.filter((o) => o.kind === "unit").length
    const s = pack.objects.filter((o) => o.kind === "stream").length
    const L = pack.objects.filter((o) => o.kind === "lesson")
    console.log(
      `${pack.course.name}: ${t} tasks, ${u} units, ${L.length} lessons (${L.reduce((a, x) => a + x.sessionDates.length, 0)} session days), ${s} stream posts` +
        (pack.undated.length ? ` · undated: ${pack.undated.map((x) => x.code).join(", ")}` : "") +
        (pack.notes.length ? `\n  ⚠ ${pack.notes.join("\n  ⚠ ")}` : ""),
    )
  }
  console.log(
    "\nBefore any load session: node date-check.mjs (vault date lint) and re-run this generator.",
  )
}
