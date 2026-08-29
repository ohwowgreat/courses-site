// managebac-verify.mjs — build the fingerprint file that answers "is ManageBac
// still what courses-site says it should be?"
//
// The platform's copy is not byte-comparable: Froala rewrites the markup on
// save (it adds <tbody>, normalises entities, reorders attributes). What does
// survive intact is the text, so both sides are compared as normalized text:
// tags stripped, entities resolved, whitespace collapsed. That catches a stale
// body, a dropped section or a hand-edit, and ignores the editor's own noise.
//
//   node managebac-verify.mjs expected.json
//
// Then upload expected.json into the browser (see the runbook: inject an
// <input type=file>, FileReader, localStorage) and run the __fast / __fastU /
// __fastT checkers against each unit, planner and task page. Anything not "OK"
// is drift, and courses-site wins.

import { readFile, writeFile } from "node:fs/promises"

export const norm = (h) =>
  h.replace(/<[^>]*>/g, " ")
   .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, "’").replace(/&hellip;/g, "…")
   .replace(/\s+/g, " ").trim()

// djb2. Must stay identical to the copy that runs in the browser.
export const djb2 = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h }

const CLASSES = { media: 11501162, "a-level": 11501153, "art-app": 11501190, "art-app-hs": 11503610, pal: 11501114 }
const UNITS = {
  media: { 1: 868718, 2: 868719, 3: 868721, 4: 868722, 5: 868724, 6: 868725 },
  "a-level": { 1: 868733, 2: 868734, 3: 868735, 4: 868736, 5: 868737 },
  "art-app": { 1: 868738, 2: 868739, 3: 868740, 4: 868741, 5: 868742 },
  "art-app-hs": { 1: 868743, 2: 868744, 3: 868745, 4: 868746, 5: 868747 },
  pal: { 1: 868700, 2: 868701, 3: 868702, 4: 868703 },
}

const out = {}
for (const k of Object.keys(CLASSES)) {
  const src = k === "art-app-hs" ? "art-app" : k
  const m = JSON.parse(await readFile(`managebac-packs/${src}/manifest.json`, "utf8"))
  const objs = m.objects ?? m
  out[k] = { classId: CLASSES[k], unitIds: UNITS[k], lessons: {}, units: {}, tasks: [] }
  for (const l of objs.filter((o) => o.kind === "lesson")) {
    const n = norm(l.html)
    out[k].lessons[l.num] = { title: l.title, unitRef: l.unitRef, len: n.length, h: djb2(n), sd: l.startDate, st: l.startTime, ed: l.endDate, et: l.endTime }
  }
  for (const u of objs.filter((o) => o.kind === "unit")) {
    const n = norm(u.html)
    out[k].units[u.num] = { title: u.title, len: n.length, h: djb2(n) }
  }
  out[k].tasks = objs.filter((o) => o.kind === "task").map((t) => ({ code: t.code, title: t.title, due: t.due, cat: t.category }))
}

const path = process.argv[2] ?? "managebac-packs/expected.json"
await writeFile(path, JSON.stringify(out))
const c = (f) => Object.values(out).reduce((a, v) => a + f(v), 0)
console.log(`${path}: ${c((v) => Object.keys(v.lessons).length)} lessons, ${c((v) => Object.keys(v.units).length)} units, ${c((v) => v.tasks.length)} tasks`)
