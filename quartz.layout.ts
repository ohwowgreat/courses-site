import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"

// This is a course site for students, not a digital garden. The graph view,
// backlinks panel, tag list and folder explorer are all vault-shaped navigation —
// they answer "how is this knowledge base wired together", which is the teacher's
// question, not a student's. What stays is what a reader needs: search, a way back
// up, and a table of contents on long pages.

export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [],
  footer: Component.Footer({ links: {} }),
}

// Breadcrumbs read the file path, but the path carries vault plumbing a reader
// shouldn't see: the "classes" wrapper folder, slug-shaped folder names, and the
// current page's own (long) title repeated under the H1. Crumbs skip the
// plumbing, use short labels, and point course crumbs at the course overview
// rather than the raw folder listing.
const breadcrumbOptions = {
  showCurrentPage: false,
  omitSegments: ["classes"],
  segmentLabels: {
    "a-level-art-design": "A Level Art & Design",
    "media-studies": "Media Studies",
    "art-appreciation": "Art Appreciation",
    "pre-a-level-art-design": "Pre A Level Art & Design",
    oxbridge: "Oxbridge",
    "lesson-plans": "Lessons",
    "unit-plans": "Units & plans",
    assessments: "Assessments",
    concepts: "Concepts",
    entities: "Theorists",
    shared: "Reference",
  },
  segmentLinks: {
    "a-level-art-design": "classes/a-level-art-design/a-level-art-design",
    "media-studies": "classes/media-studies/media-studies",
    "art-appreciation": "classes/art-appreciation/art-appreciation",
    "pre-a-level-art-design": "classes/pre-a-level-art-design/pre-a-level-art-design",
    oxbridge: "classes/oxbridge/oxbridge",
  },
}

export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    Component.ConditionalRender({
      component: Component.Breadcrumbs(breadcrumbOptions),
      condition: (page) => page.fileData.slug !== "index",
    }),
    // No ArticleTitle: every page in this vault opens with an `# H1` that already
    // matches its frontmatter title, so the component only ever double-printed it —
    // and it sat above the hero plate, splitting the title from its own artwork.
  ],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        { Component: Component.Search(), grow: true },
        { Component: Component.Darkmode() },
      ],
    }),
    // Everything lives in the left rail now: the curated site nav, then the page's
    // own table of contents. The right column is gone, so content gets more width.
    Component.SiteNav(),
    Component.TableOfContents(),
  ],
  right: [],
}

export const defaultListPageLayout: PageLayout = {
  beforeBody: [Component.Breadcrumbs(breadcrumbOptions), Component.ArticleTitle()],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        { Component: Component.Search(), grow: true },
        { Component: Component.Darkmode() },
      ],
    }),
    Component.SiteNav(),
  ],
  right: [],
}
