// The unit/lesson redesign (2026-08-25, picked from the "Lesson Pages, Three
// Ways" canvas): unit pages become a dashboard you scan, lesson pages open with
// a contract card that answers "what do I owe, and when?" before any scrolling.
// One shared chrome ties them together — a pagebar under the title (crumb ·
// progress segments · prev/next) and a prev/next footer — so the furniture never
// changes as a student moves between pages.
//
// Everything here is a rewrite of shapes the pipeline already publishes: the
// head meta line ("[[course]] · [[unit]] · Lesson 03 of 19 · ← [[..]] | [[..]] →"),
// the "## At a glance" two-column table, the "## Lessons" wikilink bullets (or
// the two units that use a table), and the "## Assessment" register table. Every
// transform is guarded by an exact-shape check, and the only acceptable failure
// is the statStrip rule: the page renders as it did yesterday. statStrip itself
// stays the fallback — a lesson page this module declines still gets its strip.
//
// Wikilinks inside the rewritten regions are resolved to <a> here, because these
// blocks ship as raw HTML and Quartz's [[wikilink]] transformer visits text
// nodes only (the same constraint that shaped statStrip's promote rule).

import { stripHtml } from "./at-a-glance.mjs"

const escHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// Cell text → HTML: unescape the register tables' `\|`, escape, resolve
// wikilinks against the page depth, then the two inline marks the cells carry.
function inline(s, depth) {
  const prefix = "../".repeat(depth)
  return escHtml(s.replace(/\\\|/g, "|"))
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, t, a) => `<a href="${prefix}${t.trim()}">${a}</a>`)
    .replace(/\[\[([^\]]+)\]\]/g, (_, t) => `<a href="${prefix}${t.trim()}">${t.trim()}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
}

const CHEV_L = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"></path></svg>`
const CHEV_R = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 3 5 5-5 5"></path></svg>`

// ── The head meta line ───────────────────────────────────────────────────────

// "[[a|A]] · [[b|B]] · Lesson 03 of 19 · ← [[p|Lesson 02]] | [[n|Lesson 04]] →"
// First lessons have no "←" half, last ones no "→" half, and one A-Level lesson
// bridges two units ("[[u1|Unit 1]] → [[u4|Unit 4]]"), which keeps its crumb but
// gets no per-unit segments — a bar for a lesson that lives in two units would
// have to lie about one of them.
//
// The vault grew dialects course by course, and each is an exact shape here:
//   Lesson 03 of 19                       most courses
//   U1·L2                                 Pre-A-Level (no global total)
//   Unit 2 of 6                           most units
//   Unit 1 · 1st of 4 this semester       A-Level semester 3 (two tokens)
export function parseMeta(body, kind) {
  const isPos =
    kind === "Lesson"
      ? (p) => {
          let m = p.match(/^Lesson (\d+) of (\d+)$/)
          if (m) return { num: +m[1], total: +m[2], span: 1 }
          m = p.match(/^U\d+·L(\d+)$/)
          if (m) return { num: +m[1], total: null, span: 1 }
          return null
        }
      : (p, following) => {
          let m = p.match(/^Unit (\d+) of (\d+)$/)
          if (m) return { num: +m[1], total: +m[2], span: 1 }
          m = p.match(/^Unit (\d+)$/)
          const ord = following?.match(/^(\d+)(?:st|nd|rd|th) of (\d+) this semester$/)
          if (m && ord) return { num: +ord[1], total: +ord[2], span: 2 }
          return null
        }

  const lines = body.split("\n")
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at].trim()
    if (!line.startsWith("[[")) continue
    const parts = line.split(" · ")
    let posIdx = -1
    let pos = null
    for (let i = 1; i < parts.length; i++) {
      pos = isPos(parts[i].trim(), parts[i + 1]?.trim())
      if (pos) {
        posIdx = i
        break
      }
    }
    if (!pos) continue
    const nav = parts.slice(posIdx + pos.span).join(" · ")
    const prev = nav.match(/←\s*\[\[([^\]|]+)\|([^\]]+)\]\]/)
    const next = nav.match(/\[\[([^\]|]+)\|([^\]]+)\]\]\s*→/)
    const unitPart = kind === "Lesson" ? parts[posIdx - 1] : null
    return {
      lineIdx: at,
      num: pos.num,
      total: pos.total,
      posText: parts.slice(posIdx, posIdx + pos.span).join(" · "),
      crumb: parts.slice(0, posIdx).join(" · "),
      prev: prev ? { target: prev[1].trim(), label: prev[2] } : null,
      next: next ? { target: next[1].trim(), label: next[2] } : null,
      // The unit the lesson belongs to, for the segments and the "of N in this
      // unit" label — null for the bridging shape.
      unitTarget:
        unitPart && !unitPart.includes("→")
          ? (unitPart.match(/\[\[([^\]|]+)\|/)?.[1] ?? null)
          : null,
    }
  }
  return null
}

function segsHtml(count, current) {
  // Twelve is already a wall of ticks; past that the bar reads as noise.
  if (!count || count < 2 || count > 12) return ""
  let out = ""
  for (let i = 1; i <= count; i++)
    out += `<i class="pb-seg${i < current ? " pb-seg--done" : i === current ? " pb-seg--now" : ""}"></i>`
  return `<span class="pb-segs" aria-hidden="true">${out}</span>`
}

function arrow(side, link, depth) {
  const svg = side === "prev" ? CHEV_L : CHEV_R
  if (!link) return `<span class="pb-arrow pb-arrow--off">${svg}</span>`
  const label = side === "prev" ? `Previous: ${link.label}` : `Next: ${link.label}`
  return `<a class="pb-arrow" href="${"../".repeat(depth)}${link.target}" aria-label="${escHtml(label)}">${svg}</a>`
}

// The pagebar replaces the meta line in place; the data is the same, the
// furniture is legible. `segs` is {count, current} or null; `label` is the
// position text beside it.
function pagebar(meta, depth, segs, label) {
  return (
    `<div class="pagebar">\n` +
    `<span class="pb-crumb">${inline(meta.crumb, depth)}</span>\n` +
    `<span class="pb-pos">${segs ? segsHtml(segs.count, segs.current) : ""}` +
    `<span class="pb-label">${escHtml(label)}</span>` +
    `${arrow("prev", meta.prev, depth)}${arrow("next", meta.next, depth)}</span>\n` +
    `</div>\n`
  )
}

// The closing counterpart: full-width prev/next with real titles, so the end of
// a page says where the road continues. Titles come from the vault scan
// (buildCourseIndex); the "Lesson 02: " half of a title is dropped because the
// label already says it.
function footerNav(meta, depth, titles) {
  const prefix = "../".repeat(depth)
  const side = (link, cls, arrowTxt) => {
    if (!link) return `<span class="page-nav-slot"></span>`
    // Vault H1s carry the teacher's codes ("9607 S1 Lesson 02: Semiotics…");
    // the footer label already names the lesson, so everything up to and
    // including that token goes.
    const title = (titles.get(link.target) ?? "").replace(/^.*?(?:Lesson|Unit)\s+\d+\s*[:.]\s*/, "")
    const text = title ? `${link.label} · ${title}` : link.label
    const body = cls === "page-nav-prev" ? `← ${escHtml(text)}` : `${escHtml(text)} →`
    return `<a class="${cls}" href="${prefix}${link.target}">${body}</a>`
  }
  return (
    `<div class="page-nav">\n${side(meta.prev, "page-nav-prev")}\n${side(meta.next, "page-nav-next")}\n</div>\n`
  )
}

// ── The vault scan ───────────────────────────────────────────────────────────

// One pass over the vault's lesson and unit pages before the sync loop: titles
// for the footers, and each unit's lesson roster for the segments. Keyed by
// wikilink target (the vault path sans .md), which is what the meta lines carry.
export function buildCourseIndex(pages) {
  const titles = new Map()
  const units = new Map() // unit target → [{num, target}]
  for (const { rel, raw } of pages) {
    const target = rel.replace(/\.md$/, "")
    const title = raw.match(/^#\s+(.+)$/m)?.[1]
    if (title) titles.set(target, title.trim())
    if (!/\/lesson-plans\//.test(rel)) continue
    const meta = parseMeta(raw, "Lesson")
    if (!meta?.unitTarget) continue
    if (!units.has(meta.unitTarget)) units.set(meta.unitTarget, [])
    units.get(meta.unitTarget).push({ num: meta.num, target })
  }
  for (const list of units.values()) list.sort((a, b) => a.num - b.num)
  return { titles, units }
}

// ── The lesson contract card ─────────────────────────────────────────────────

// Consumes the whole "## At a glance" section — heading, strip rows and prose
// rows alike — and reshapes it into the contract card. Runs before statStrip;
// when this declines a page (no heading, an unknown table shape, no Deliverable
// row), statStrip still finds the table untouched and the page keeps last
// week's look.
function atAGlanceRows(body) {
  const lines = body.split("\n")
  const h = lines.findIndex((l) => l.trim() === "## At a glance")
  if (h === -1) return null
  let head = h + 1
  while (head < lines.length && lines[head].trim() === "") head++
  if (!lines[head]?.trimStart().startsWith("|")) return null
  if (!/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[head + 1] ?? "")) return null
  const rows = []
  let end = head + 2
  while (end < lines.length && lines[end].trimStart().startsWith("|")) {
    const cells = lines[end].split(/(?<!\\)\|/).filter((c, i, a) => !(i === 0 || i === a.length - 1))
    if (cells.length !== 2) return null
    rows.push({ label: cells[0].trim(), value: cells[1].trim() })
    end++
  }
  if (!rows.length) return null
  return { lines, from: h, to: end, rows }
}

const CARD_WHEN = ["Dates", "Date"]
const CARD_WHEN_NOTE = ["Days", "Sessions", "Session", "Session codes"]

export function contractCard(body, depth, deck) {
  const found = atAGlanceRows(body)
  if (!found) return null
  const byLabel = new Map(found.rows.map((r) => [r.label, r.value]))
  const deliverable = byLabel.get("Deliverable")
  if (!deliverable) return null

  const taken = new Set(["Deliverable"])
  const take = (labels) => {
    for (const l of labels) if (byLabel.has(l)) return (taken.add(l), byLabel.get(l))
    return null
  }

  const when = take(CARD_WHEN)
  // The note keeps its label — "Days: 2 · Mon single, Tue single" reads;
  // a bare "2 · Mon single, Tue single" under the dates does not.
  let whenNote = null
  for (const l of CARD_WHEN_NOTE)
    if (byLabel.has(l)) {
      whenNote = `${l}: ${byLabel.get(l)}`
      taken.add(l)
      break
    }
  const ao = take(["AO focus"])
  const feeds = take(["Feeds"])
  const carries = take(["Carries forward"])
  const homework = take(["Homework"])

  const chips = ao
    ? `<span class="contract-aos">` +
      ao
        .split(/\s*[+·,]\s*/)
        .filter(Boolean)
        .map((a) => `<span class="contract-ao">${escHtml(a)}</span>`)
        .join("") +
      `</span>`
    : ""

  const cell = (label, value, note) =>
    `<div class="contract-cell"><span class="contract-cell-label">${escHtml(label)}</span>` +
    `<span class="contract-cell-value">${value}${note ? `<span class="contract-cell-note">${note}</span>` : ""}</span></div>`
  const cells = []
  if (when) cells.push(cell("When", inline(when, depth), whenNote && inline(whenNote, depth)))
  if (feeds) cells.push(cell("Feeds", inline(feeds, depth)))
  if (carries) cells.push(cell("Carries forward", inline(carries, depth)))

  // Whatever this course's table carries beyond the featured rows (Band/Unit,
  // Template, Focus, …) survives as small labeled lines — the card absorbs the
  // table, it does not curate it down.
  const more = found.rows
    .filter((r) => !taken.has(r.label))
    .map(
      (r) =>
        `<span class="contract-line"><span class="contract-line-label">${escHtml(r.label)}</span> ${inline(r.value, depth)}</span>`,
    )
    .join("\n")

  const deckBtn = deck
    ? `<a class="contract-deck" href="${deck.href}">` +
      `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8m0 0 3-3M8 10 5 7"></path><path d="M3 12v1.5h10V12"></path></svg>` +
      `Lesson slides (${deck.size})</a><a class="contract-credits" href="${deck.credits}">image credits</a>`
    : ""
  const hw = homework
    ? `<span class="contract-hw"><span class="contract-line-label">Homework</span> ${inline(homework, depth)}</span>`
    : ""
  const foot = deckBtn || hw ? `<div class="contract-foot">${deckBtn}${hw}</div>` : ""

  const html =
    `<div class="contract">\n` +
    `<div class="contract-head"><span class="contract-kicker">Your job this lesson</span>${chips}</div>\n` +
    `<p class="contract-job">${inline(deliverable, depth)}</p>\n` +
    (cells.length ? `<div class="contract-grid">\n${cells.join("\n")}\n</div>\n` : "") +
    foot +
    (more ? `\n<div class="contract-more">\n${more}\n</div>` : "") +
    `\n</div>\n`

  const { lines, from, to } = found
  return [...lines.slice(0, from), html, ...lines.slice(to)].join("\n")
}

// ── The unit dashboard ───────────────────────────────────────────────────────

// "## Lessons" as the vault writes it: either a run of `- [[target|Lesson NN:
// Title]]: description` bullets (most units) or the four-column table two units
// use. Both become the same row list; anything else stays as written.
function unitLessonRows(body, depth) {
  const lines = body.split("\n")
  const h = lines.findIndex((l) => l.trim() === "## Lessons")
  if (h === -1) return null
  let at = h + 1
  while (at < lines.length && lines[at].trim() === "") at++

  const rows = []
  let end = at
  if (lines[at]?.trimStart().startsWith("- ")) {
    while (end < lines.length && lines[end].trimStart().startsWith("- ")) {
      const m = lines[end]
        .trim()
        .match(/^-\s*\[\[([^\]|]+)\|((?:Lesson\s+)?L?\d+[^\]]*)\]\]\s*[:—-]?\s*(.*)$/)
      if (!m) return null
      const [, target, alias, desc] = m
      const t = alias.match(/^(?:Lesson\s+)?L?(\d+)[:.]?\s*(.*)$/)
      rows.push({ target: target.trim(), num: t[1], title: t[2] || alias, meta: "", desc })
      end++
    }
  } else if (lines[at]?.trimStart().startsWith("|")) {
    const header = lines[at].split(/(?<!\\)\|/).map((c) => c.trim().toLowerCase())
    if (!header.includes("lesson") || !/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[at + 1] ?? ""))
      return null
    const cols = lines[at]
      .split(/(?<!\\)\|/)
      .filter((c, i, a) => !(i === 0 || i === a.length - 1))
      .map((c) => c.trim().toLowerCase())
    end = at + 2
    while (end < lines.length && lines[end].trimStart().startsWith("|")) {
      const cells = lines[end].split(/(?<!\\)\|/).filter((c, i, a) => !(i === 0 || i === a.length - 1))
      if (cells.length !== cols.length) return null
      // Table cells escape their pipes (`[[target\|alias]]`); unescape before the
      // wikilink parse or the target keeps a stray backslash in its href.
      const get = (name) => (cells[cols.indexOf(name)]?.trim() ?? "").replace(/\\\|/g, "|")
      const lessonCell = get("lesson")
      const lm = lessonCell.match(/^\[\[([^\]|]+)\|([^\]]+)\]\]$/)
      const alias = lm ? lm[2] : lessonCell
      const t = alias.match(/^(?:Lesson\s+)?L?(\d+)[:.]?\s*(.*)$/)
      if (!t) return null
      const days = get("days")
      const dates = get("dates")
      const out = get("practical output") || get("deliverable")
      rows.push({
        target: lm ? lm[1].trim() : null,
        num: t[1],
        title: (t[2] || alias).trim(),
        meta: [days && `${days} day${days === "1" ? "" : "s"}`, dates].filter(Boolean).join(" · "),
        desc: out ? `You make: ${out}` : "",
      })
      end++
    }
  } else return null
  if (rows.length < 2) return null

  const prefix = "../".repeat(depth)
  // The row is a <div>, not an <a>: descriptions carry their own links
  // (assessment codes), and an anchor inside an anchor is auto-closed by the
  // HTML parser, which blew the row apart at the first inner link. The title's
  // stretched ::after (see .ul-title in custom.scss) keeps the whole row
  // clickable anyway.
  const html =
    `<div class="unit-lessons">\n` +
    rows
      .map(
        (r) =>
          `<div class="ul-row">` +
          `<span class="ul-num">L${r.num}</span>` +
          `<span class="ul-body"><span class="ul-head">` +
          (r.target
            ? `<a class="ul-title" href="${prefix}${r.target}">${escHtml(r.title)}</a>`
            : `<span class="ul-title">${escHtml(r.title)}</span>`) +
          (r.meta ? ` <span class="ul-meta">· ${escHtml(r.meta)}</span>` : "") +
          `</span>` +
          (r.desc ? `<span class="ul-desc">${inline(r.desc, depth)}</span>` : "") +
          `</span>` +
          `<span class="ul-chev">${CHEV_R}</span>` +
          `</div>`,
      )
      .join("\n") +
    `\n</div>\n`
  return { body: [...lines.slice(0, at), html, ...lines.slice(end)].join("\n"), count: rows.length, rows }
}

// "## Assessment" register table (Item | Date | What [| AO]) → the due-dates
// card. The heading and any prose around the table stay; only the table turns.
function unitDueCard(body, depth) {
  const lines = body.split("\n")
  const h = lines.findIndex((l) => l.trim() === "## Assessment")
  if (h === -1) return null
  let at = h + 1
  while (at < lines.length && !lines[at].trimStart().startsWith("|")) {
    if (lines[at].trim().startsWith("## ")) return null
    at++
  }
  if (at >= lines.length) return null
  const cols = lines[at]
    .split(/(?<!\\)\|/)
    .filter((c, i, a) => !(i === 0 || i === a.length - 1))
    .map((c) => c.trim().toLowerCase())
  if (cols[0] !== "item" || !cols.includes("date") || !cols.includes("what")) return null
  if (!/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[at + 1] ?? "")) return null
  const rows = []
  let end = at + 2
  while (end < lines.length && lines[end].trimStart().startsWith("|")) {
    const cells = lines[end].split(/(?<!\\)\|/).filter((c, i, a) => !(i === 0 || i === a.length - 1))
    if (cells.length !== cols.length) return null
    const get = (name) => cells[cols.indexOf(name)]?.trim() ?? ""
    rows.push({ item: get("item"), date: get("date"), what: get("what"), ao: get("ao") })
    end++
  }
  if (rows.length < 2) return null

  const html =
    `<div class="duecard">\n` +
    `<span class="duecard-kicker">Due dates at a glance</span>\n` +
    rows
      .map(
        (r) =>
          `<div class="duecard-row"><span class="duecard-top"><span class="duecard-item">${inline(r.item, depth)}</span>` +
          `<span class="duecard-date">${inline(r.date, depth)}</span></span>` +
          `<span class="duecard-what">${inline(r.what, depth)}${r.ao ? `<span class="duecard-ao">${escHtml(r.ao)}</span>` : ""}</span></div>`,
      )
      .join("\n") +
    `\n</div>\n`
  return { body: [...lines.slice(0, at), html, ...lines.slice(end)].join("\n"), count: rows.length }
}

// ── The two entry points ─────────────────────────────────────────────────────

// Both return { body, footer } — the footer is appended by sync.mjs after the
// Practice details land, so it stays the last thing on the page.

export function lessonChrome(body, depth, deck, index) {
  const meta = parseMeta(body, "Lesson")
  if (!meta) return null

  let segs = null
  const l = `L${String(meta.num).padStart(2, "0")}`
  let label = meta.total ? `Lesson ${String(meta.num).padStart(2, "0")} of ${meta.total}` : meta.posText
  const roster = meta.unitTarget && index.units.get(meta.unitTarget)
  if (roster) {
    const at = roster.findIndex((x) => x.num === meta.num)
    if (at !== -1) {
      segs = { count: roster.length, current: at + 1 }
      label = `Lesson ${at + 1} of ${roster.length} in this unit · ${meta.total ? `${l} of ${meta.total}` : l}`
    }
  }

  const lines = body.split("\n")
  lines[meta.lineIdx] = pagebar(meta, depth, segs, label)
  let out = lines.join("\n")

  let carded = contractCard(out, depth, deck)
  // The Learn / Do / Check staging, on carded pages only: the three section
  // names are uniform across all of them (verified 106/106 on 2026-08-26), and
  // a page whose shape differs — Oxbridge's seminars — keeps its own names.
  // Exact whole-line matches; each heading occurs once.
  if (carded) {
    carded = carded
      .replace(/^## The ideas$/m, "## 1 · Learn")
      .replace(/^## Day by day$/m, "## 2 · Do")
      .replace(/^## Review$/m, "## 3 · Check")
  }
  return { body: carded ?? out, footer: footerNav(meta, depth, index.titles), carded: !!carded }
}

export function unitChrome(body, depth, index, heroHtml = null) {
  const meta = parseMeta(body, "Unit")
  if (!meta) return null

  const lines = body.split("\n")
  // The hero rides beside the title and lede as a right-floated side plate (the
  // picked mockup's shape) instead of a full-bleed banner — placed here, right
  // after the pagebar, so the lede wraps around it.
  lines[meta.lineIdx] =
    pagebar(meta, depth, { count: meta.total, current: meta.num }, meta.posText) +
    (heroHtml ? `\n${heroHtml}` : "")

  // "## What this unit does" gives way to a lede: with the dashboard above the
  // fold the prose introduces the unit directly under the title, and a heading
  // announcing that it is about to do so is furniture. Exact match only — a
  // unit that names the section differently keeps its heading.
  const wtud = lines.findIndex((l) => l.trim() === "## What this unit does")
  if (wtud !== -1) lines.splice(wtud, 1)
  let out = lines.join("\n")

  const lessons = unitLessonRows(out, depth)
  if (lessons) out = lessons.body
  const due = unitDueCard(out, depth)
  if (due) out = due.body

  // The masthead strip, directly under the lede — before the first remaining
  // heading, so the unit's numbers are above the fold. Only when the counts
  // exist (stripHtml itself refuses a one-cell strip). Span is read from the
  // "## Dates & span" paragraph when it has the house shape.
  if (lessons && due) {
    const first = lessons.rows[0].num
    const last = lessons.rows[lessons.rows.length - 1].num
    const cells = []
    const outLines = out.split("\n")
    const ds = outLines.findIndex((l) => l.trim() === "## Dates & span")
    if (ds !== -1) {
      let p = ds + 1
      while (p < outLines.length && outLines[p].trim() === "") p++
      const m = outLines[p]
        ?.replace(/\*\*/g, "")
        .match(/^(W\d+(?:\s*(?:to|–|—|→)\s*W\d+)?):.*?,\s*(\d+) teaching days/)
      if (m) cells.push({ label: "Span", value: m[1].replace(/\s*to\s*/, "–"), note: `${m[2]} teaching days` })
    }
    cells.push(
      { label: "Lessons", value: String(lessons.count), note: `L${first}–L${last}` },
      { label: "Graded items", value: String(due.count) },
    )
    // First h2 from the top — the H1 is a single hash, so this is the first
    // section heading, wherever the earlier transforms left it.
    const strip = stripHtml(cells).trimEnd()
    const at = outLines.findIndex((l) => /^## /.test(l.trim()))
    if (at !== -1) out = [...outLines.slice(0, at), strip, "", ...outLines.slice(at)].join("\n")
  }

  return { body: out, footer: footerNav(meta, depth, index.titles) }
}
