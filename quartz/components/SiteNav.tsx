import { FullSlug, SimpleSlug, resolveRelative } from "../util/path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
// Shared with sync.mjs's course-map injection, so the drawer and the on-page map
// always agree about what a subpage is.
import { classify } from "../../course-map.mjs"

// Curated left-hand navigation. Each course is a <details> drawer listing its
// subpages, derived from allFiles at build time — native disclosure, no JS, and
// the drawer for the course you're currently reading opens automatically.
const COURSES = [
  { title: "A Level Art & Design", dir: "classes/a-level-art-design", overview: "a-level-art-design" },
  { title: "Media Studies", dir: "classes/media-studies", overview: "media-studies" },
  { title: "Art Appreciation", dir: "classes/art-appreciation", overview: "art-appreciation" },
  {
    title: "Pre A Level Art & Design",
    dir: "classes/pre-a-level-art-design",
    overview: "pre-a-level-art-design",
  },
  { title: "Oxbridge", dir: "classes/oxbridge", overview: "oxbridge" },
]

const SiteNav: QuartzComponent = ({ fileData, allFiles, displayClass }: QuartzComponentProps) => {
  const here = fileData.slug!
  const rel = (slug: string) => resolveRelative(here, slug as FullSlug)

  return (
    <nav class={classNames(displayClass, "site-nav")}>
      <div class="site-nav-group">
        <ul>
          <li>
            <a href={resolveRelative(here, "/" as FullSlug)}>Home</a>
          </li>
          <li>
            <a href={rel("calendar")} class={here === "calendar" ? "active" : ""}>
              Calendar
            </a>
          </li>
        </ul>
      </div>

      <div class="site-nav-group">
        <h3 class="site-nav-heading">Courses</h3>
        {COURSES.map((c) => {
          const prefix = c.dir + "/"
          const overviewSlug = `${c.dir}/${c.overview}`
          const inCourse = here.startsWith(prefix)

          const subs = allFiles
            .filter((f) => f.slug!.startsWith(prefix) && f.slug! !== overviewSlug)
            .map((f) => ({
              slug: f.slug!,
              info: classify(
                f.slug!.slice(prefix.length) + ".md",
                (f.frontmatter?.title as string) ?? f.slug!.split("/").pop()!,
              ),
            }))
            .filter((s) => s.info)

          const group = (g: string) =>
            subs.filter((s) => s.info!.group === g).sort((a, b) => a.info!.sort - b.info!.sort)

          // A multi-semester course (A Level) lists only its live-semester units in
          // the drawer; the full set is on the course map on the overview page.
          let units = group("units")
          const sems = new Set(units.map((u) => u.info!.sem))
          if (sems.size > 1) units = units.filter((u) => u.info!.sem === 1)
          const lessons = group("lessons")
          const planRow = [...group("calendar"), ...group("plans"), ...group("assessments"), ...group("more")]

          return (
            <details class="site-nav-course" open={inCourse}>
              <summary>
                <span class={here === overviewSlug ? "active" : ""}>{c.title}</span>
              </summary>
              <ul>
                <li>
                  <a href={rel(overviewSlug)} class={here === overviewSlug ? "active" : ""}>
                    Overview
                  </a>
                </li>
                {planRow.map((s) => (
                  <li>
                    <a href={rel(s.slug)} class={here === s.slug ? "active" : ""}>
                      {s.info!.label}
                    </a>
                  </li>
                ))}
                {units.map((s) => (
                  <li class="site-nav-unit">
                    <a href={rel(s.slug)} class={here === s.slug ? "active" : ""}>
                      {s.info!.label}
                    </a>
                  </li>
                ))}
              </ul>
              {lessons.length > 0 && (
                <div class="site-nav-chips">
                  {lessons.map((s) => (
                    <a
                      href={rel(s.slug)}
                      class={here === s.slug ? "active" : ""}
                      title={s.info!.tip || undefined}
                    >
                      {s.info!.label}
                    </a>
                  ))}
                </div>
              )}
            </details>
          )
        })}
      </div>

      <div class="site-nav-group">
        <h3 class="site-nav-heading">Reference</h3>
        <ul>
          <li>
            <a
              href={rel("shared/bnds-assessment-framework")}
              class={here === "shared/bnds-assessment-framework" ? "active" : ""}
            >
              How grading works
            </a>
          </li>
        </ul>
      </div>
    </nav>
  )
}

SiteNav.css = `
.site-nav {
  margin: 0.4rem 0 0.5rem;
  font-size: 0.9rem;
}
.site-nav-group { margin-bottom: 1.1rem; }
.site-nav-heading {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  font-weight: 650;
  color: var(--gray);
  margin: 0 0 0.4rem;
}
.site-nav ul { list-style: none; margin: 0; padding: 0; }
.site-nav li { margin: 0; }
.site-nav a {
  display: block;
  padding: 0.2rem 0;
  color: var(--darkgray);
  text-decoration: none;
  line-height: 1.35;
  transition: color 0.12s ease;
}
.site-nav a:hover { color: var(--secondary); }
.site-nav a.active, .site-nav span.active {
  color: var(--secondary);
  font-weight: 600;
}

/* Course drawers */
.site-nav-course { margin: 0; }
.site-nav-course summary {
  cursor: pointer;
  padding: 0.2rem 0;
  color: var(--darkgray);
  line-height: 1.35;
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}
.site-nav-course summary::-webkit-details-marker { display: none; }
.site-nav-course summary::after {
  content: "›";
  color: var(--gray);
  font-size: 0.85rem;
  transition: transform 0.15s ease;
  flex-shrink: 0;
}
.site-nav-course[open] > summary::after { transform: rotate(90deg); }
.site-nav-course summary:hover { color: var(--secondary); }
.site-nav-course > ul {
  margin: 0.1rem 0 0.4rem;
  padding-left: 0.75rem;
  border-left: 1px solid var(--lightgray);
}
.site-nav-course > ul a { font-size: 0.84rem; padding: 0.14rem 0; }
.site-nav-unit a { color: var(--gray); }
.site-nav-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin: 0 0 0.6rem 0.75rem;
}
.site-nav-chips a {
  font-size: 0.68rem;
  padding: 1px 5px;
  border: 1px solid var(--lightgray);
  border-radius: 3px;
  color: var(--gray);
  line-height: 1.4;
}
.site-nav-chips a:hover { border-color: var(--secondary); color: var(--secondary); }
.site-nav-chips a.active { border-color: var(--secondary); color: var(--secondary); font-weight: 650; }
`

export default (() => SiteNav) satisfies QuartzComponentConstructor
