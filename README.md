# Courses site

Student-facing website built from the `Courses` Obsidian vault, using
[Quartz v4](https://quartz.jzhao.xyz).

The vault is teacher-facing. `sync.mjs` is the gate between it and the published site —
it reads `~/Documents/Vaults/Courses/wiki/`, filters, **reframes each page into
student-facing voice** (see below), and writes `content/`. It never writes to the vault.

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
`node sync.mjs` locally → review the `content/` diff → commit → push.** The push triggers
the rebuild. The diff review matters more now that a model rewrites the prose — it is the
last look every page gets before it goes public.

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

## Automated publishing

Once installed, the only thing to manage is the vault — the site publishes itself.

```sh
# one-time, on the Mac:
security add-generic-password -U -a "$USER" -s ANTHROPIC_API_KEY -w 'sk-ant-...'
./install-autosync.sh          # daily at 18:00 (or: ./install-autosync.sh 7)
```

This registers `auto-sync.mjs` as a launchd user agent. Each run does what the manual
workflow did — `node sync.mjs` → commit `content/` → push `main` — and Vercel deploys.
If the Mac is asleep at the scheduled time, the run happens on wake. When nothing in
the vault changed, the run is a no-op (all cache hits, no commit, no API cost).

Automation removes the human diff review, so `auto-sync.mjs` is deliberately cowardly:

- publishes only from a clean `main` that fast-forwards to origin; anything odd
  (other branch, uncommitted edits outside `content/`, diverged history) skips with a
  macOS notification instead of guessing;
- **never publishes a run with a ⚠ warning** — a failed or suspicious rewrite sends a
  notification and nothing goes out; the next scheduled run retries (failed rewrites
  are never cached), so transient API errors self-heal;
- the privacy filter never depends on any of this: it runs deterministically inside
  `sync.mjs` before any page reaches the model.

Runs log to `~/Library/Logs/courses-autosync.log`. Test a run immediately with
`launchctl start com.courses-site.autosync`; uninstall with
`launchctl unload ~/Library/LaunchAgents/com.courses-site.autosync.plist`.

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
the image-slide library catalog, the school academic calendar (every student-relevant date
on it is already on the hub calendar page, which is a strict superset; the rest is planning
analysis), the `9607-theory-provenance` analysis (teacher-facing in its entirety), and the
three superseded/legacy pages. Plus the vault's `home.md`, which is a teacher's dashboard;
the site uses `site-home.md` instead.

Links to a withheld page normally degrade to plain text, but `LINK_REDIRECTS` in
`sync.mjs` can retarget them to a published equivalent instead — the school calendar's
links point at the hub calendar this way.

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

## Student-voice reframe (the second stage)

The filter above can only *delete*. The prose that survives it is still written in the
vault's planning voice — "lesson docs are still to write", source-spreadsheet
comparisons, instructions to staff — which regex cannot rewrite. So after the filter,
`reframe.mjs` sends each surviving page body to the Claude API
(`claude-opus-4-8`) with a fixed style contract: keep every fact a student can
act on (dates, codes, requirements, grading), remove planning status / provenance /
staff instructions, reframe the rest as information for the student, never invent
anything, keep wikilinks exactly as written.

**Order is the trust model.** The deterministic filter runs first and is the privacy
gate — withheld pages and stripped sections never reach the model. The model handles
tone, never secrecy: on a bad day it can produce awkward prose (caught in the diff
review), but it cannot leak a page it never saw.

**Caching.** Results live in `reframe-cache.json` (committed), keyed by a hash of
(model, prompt version, filtered body). A sync only pays model calls for pages whose
filtered text actually changed — a typical sync rewrites a handful of pages; untouched
pages are byte-identical from cache, so the `content/` diff stays small and reviewable.
The first-ever run rewrites all ~140 pages (several minutes, a few dollars). Editing
the prompt in `reframe.mjs` requires bumping `PROMPT_VERSION`, which invalidates the
whole cache on purpose.

**Credentials.** Needs `ANTHROPIC_API_KEY` in the environment (or an `ant auth login`
profile) on the machine running the sync. Without credentials, `REFRAME=off node
sync.mjs` publishes filter-only output and warns loudly about every page that shipped
unreframed; the sync aborts before touching `content/` if pages changed and no
credentials are available.

**Guardrails.** Each rewrite is checked for surviving teacher-voice fragments ("the
human", `raw/`, "ingested", "exams officer", …) and for invented wikilink targets; a
failing rewrite gets one corrective retry, then ships with a loud warning and is *not*
cached, so every future sync re-attempts and re-warns until it's clean. `calendar.md`
is excluded from the reframe (it's a dates-only agenda, and the month-view injection
anchors on its headings).

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
