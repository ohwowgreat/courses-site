# Courses site

Student-facing website built from the `Courses` Obsidian vault, using
[Quartz v4](https://quartz.jzhao.xyz).

The vault is teacher-facing. `sync.mjs` is the gate between it and the published site —
it reads `~/Documents/Vaults/Courses/wiki/`, filters, and writes `content/`. It never
writes to the vault.

## Deployment

Hosted on Vercel / Cloudflare Pages, which build straight from this repo on every push.

| Setting | Value |
|---|---|
| Build command | `npx quartz build` |
| Output directory | `public` |
| Install command | `npm ci` |
| Node version | 22 (pinned in `.nvmrc` / `.node-version`) |

`content/` is committed on purpose — the build host has no access to the source vault, so
it builds from the checked-in snapshot. **The deploy workflow is: edit the vault → run
`node sync.mjs` locally → commit `content/` → push.** The push triggers the rebuild.

After the first deploy, set `baseUrl` in `quartz.config.ts` to the assigned domain (e.g.
`courses.pages.dev`) and push again — it only affects the sitemap and social-share
(`og:`) image URLs, so the site works before you do, but links shared to social won't
preview correctly until it's set.

## Why this lives outside the vault folder

`~/Documents` is under cloud sync (the vault's own notes record Tencent WeDrive markers
throughout `raw/`). While this site sat in `~/Documents/Vaults/`, the sync client kept
restoring deleted build output as conflict copies — `index 2.md` inside `content/`,
`index-2 2.html` inside `public/`. Those landed *after* the filter had run, so they
reached the site unchecked and published stale duplicate pages at `/index-2`. Builds also
slowed from 1s to over a minute.

Keep this directory out of any synced folder. `sync.mjs` prunes strays defensively and
`quartz.config.ts` ignores conflict-copy filenames, but neither is a substitute for the
build output not being synced in the first place.

## Rebuild after changing the vault

```sh
cd ~/courses-site
node sync.mjs && npx quartz build --serve --port 8080
```

`content/` and `public/` are both generated. Don't edit them — changes are lost on the
next sync. Edit the vault, or `site-home.md` for the landing page.

To change the artwork: edit the `PLATES` list in `images.mjs`, run `node images.mjs`, then
re-sync. Which page gets which plate is the `HEROES` map in `sync.mjs`.

## What the filter withholds

Defined at the top of `sync.mjs`.

**Whole pages** — `index.md`, `log.md`, `courses-dashboard.md`, the first-session opener,
the image-slide library catalog, and the three superseded/legacy pages. Plus the vault's
`home.md`, which is a teacher's dashboard; the site uses `site-home.md` instead.

**Sections**, stripped from every page that has them — `Teacher notes`, `Contingencies`,
`Open items`, `Applied rules`, `Notice and marking rules`, `Gaps`, `Holdings`,
`Class workspace`, `Readings — teacher reference`, and the course-overview planning
sections (`Open decisions`, `Known inconsistencies`, `Flags`, `⚠ Old-spec traps`,
`⚠ The syllabus straddle`, `Missing from`, and others — see the list in `sync.mjs`).
Matched by heading prefix, so `## Gaps this material does *not* fill` is caught by `Gaps`.

**Assessment registers are published, cleaned.** They carry real student value — per-item
dates, formats, AO focus, and the direct-practice chain. `cleanRegister()` in `sync.mjs`
strips their internal parts: the `Announced`/`Gap` table columns, the notice-correction and
timetable-redraw callouts, the `Codes:` mapping note, the rule/open-items sections (above),
and a few inline planning stamps (`Resolved <date>`, `Confirmed by the human`,
`Open question:`). The general grading rules the registers restate already live on the
published `bnds-assessment-framework` page.

**Frontmatter** — `sources:` is dropped (those paths point into `raw/`), and `related:`
entries pointing at withheld pages are pruned. `last_updated` becomes `modified` so page
dates reflect the vault rather than the last sync.

Links to withheld pages degrade to plain text, so the site has no dead ends. Verified at
0 broken wikilinks across 136 pages.

## Artwork

Ten plates in `quartz/static/img/`, selected from the shared Image Slides library and
downsampled by `images.mjs` (nothing is served from the 7.2 GB original set). Credits are
generated into `credits.json` and rendered under each image.

Selection is restricted to work published before ~1930, which is public domain. The
library also holds in-copyright photography — Tillmans, Gursky, Sherman, Weems — that is
fine to project in a classroom but not to republish on a public website. If you add plates,
keep that line.

## The calendar publishes all dates — this is fine

`content/calendar.md` carries every attainment for all five courses through 2027-01-07,
from day one. That is correct, not a leak. The notice rule is a **floor** — assessments
must be announced *at least* 14 days ahead — so publishing dates earlier gives students
more than the required notice, never less. Nothing forbids early visibility.

## Never publish `raw/`

It holds 8.7 GB of copyrighted readings (Benjamin, Berger, Sontag), CIE syllabi, and
licensed image sets. `sync.mjs` only ever reads `wiki/`.
