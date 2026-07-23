// Citation helper: in-copyright works are cited in lessons, never embedded.
//
// Renders a small, image-free citation line — "Shown in class · Artist, *Title*,
// Year" with an optional source link — and injects it at an anchor in a page
// body, mirroring insertFigures() in sync.mjs. The CITATIONS map lives in
// sync.mjs (like FIGURES); this module only renders and places the entries.
//
// An entry: { cite: "Mark Rothko, *Blue and Gray*, 1962", src?: "https://…",
//             anchor?: /regex/ }.  Omit or fail the anchor and it appends to the
// end of the page. Leave src off (or "TODO") for a placeholder to fill later.

export function citationHtml(entry) {
  const work = entry.cite.replace(/\*([^*]+)\*/g, "<em>$1</em>")
  const link =
    entry.src && entry.src !== "TODO"
      ? ` <a class="cite-link" href="${entry.src}" target="_blank" rel="noopener">view →</a>`
      : ``
  return `<p class="cite"><span class="cite-tag">Shown in class</span>${work}${link}</p>\n`
}

export function insertCitations(body, entries) {
  for (const entry of entries) {
    const html = citationHtml(entry)
    const at = entry.anchor ? body.search(entry.anchor) : -1
    if (at === -1) {
      body = body.trimEnd() + "\n\n" + html
      continue
    }
    const paraEnd = body.indexOf("\n\n", at)
    const pos = paraEnd === -1 ? -1 : paraEnd + 2
    body =
      pos === -1
        ? body.trimEnd() + "\n\n" + html
        : body.slice(0, pos) + "\n" + html + body.slice(pos)
  }
  return body
}
