import { FullSlug, SimpleSlug, resolveRelative } from "../util/path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

// A curated left-hand navigation for the student site. Deliberately hand-picked
// rather than an auto-generated folder tree: students want the courses, the
// calendar and the shared references — not lesson-plan subfolders full of slugs.
// Each course links to its overview; per-lesson browsing happens from there.
type NavLink = { title: string; slug: SimpleSlug }
type NavGroup = { heading?: string; links: NavLink[] }

const GROUPS: NavGroup[] = [
  {
    links: [
      { title: "Home", slug: "/" as SimpleSlug },
      { title: "Calendar", slug: "calendar" as SimpleSlug },
    ],
  },
  {
    heading: "Courses",
    links: [
      {
        title: "A Level Art & Design",
        slug: "classes/a-level-art-design/a-level-art-design" as SimpleSlug,
      },
      { title: "Media Studies", slug: "classes/media-studies/media-studies" as SimpleSlug },
      {
        title: "Art Appreciation",
        slug: "classes/art-appreciation/art-appreciation" as SimpleSlug,
      },
      {
        title: "Pre A Level Art & Design",
        slug: "classes/pre-a-level-art-design/pre-a-level-art-design" as SimpleSlug,
      },
      { title: "Oxbridge", slug: "classes/oxbridge/oxbridge" as SimpleSlug },
    ],
  },
  {
    heading: "Reference",
    links: [
      { title: "How grading works", slug: "shared/bnds-assessment-framework" as SimpleSlug },
      { title: "School calendar", slug: "shared/school-academic-calendar" as SimpleSlug },
    ],
  },
]

const SiteNav: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  const here = fileData.slug!
  return (
    <nav class={classNames(displayClass, "site-nav")}>
      {GROUPS.map((group) => (
        <div class="site-nav-group">
          {group.heading && <h3 class="site-nav-heading">{group.heading}</h3>}
          <ul>
            {group.links.map(({ title, slug }) => {
              // "/" is the home root; every other entry resolves relative to the
              // current page so links hold at any depth and under a subpath.
              const href =
                slug === "/"
                  ? resolveRelative(here, "/" as FullSlug)
                  : resolveRelative(here, slug as unknown as FullSlug)
              const isCurrent = here === (slug as unknown as string)
              return (
                <li>
                  <a href={href} class={isCurrent ? "active" : ""}>
                    {title}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
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
.site-nav a.active {
  color: var(--secondary);
  font-weight: 600;
}
`

export default (() => SiteNav) satisfies QuartzComponentConstructor
