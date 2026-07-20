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

export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    Component.ConditionalRender({
      component: Component.Breadcrumbs(),
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
  beforeBody: [Component.Breadcrumbs(), Component.ArticleTitle()],
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
