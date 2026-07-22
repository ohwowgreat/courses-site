import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import breadcrumbsStyle from "./styles/breadcrumbs.scss"
import { FullSlug, SimpleSlug, resolveRelative, simplifySlug } from "../util/path"
import { classNames } from "../util/lang"
import { trieFromAllFiles } from "../util/ctx"

type CrumbData = {
  displayName: string
  path: string
}

interface BreadcrumbOptions {
  /**
   * Symbol between crumbs
   */
  spacerSymbol: string
  /**
   * Name of first crumb
   */
  rootName: string
  /**
   * Whether to look up frontmatter title for folders (could cause performance problems with big vaults)
   */
  resolveFrontmatterTitle: boolean
  /**
   * Whether to display the current page in the breadcrumbs.
   */
  showCurrentPage: boolean
  /**
   * Path segments dropped from the chain entirely (e.g. a "classes" wrapper
   * folder that means nothing to readers).
   */
  omitSegments: string[]
  /**
   * Display label overrides per path segment ("lesson-plans" → "Lessons").
   */
  segmentLabels: Record<string, string>
  /**
   * Link target overrides per path segment — e.g. point a course folder crumb
   * at the course overview page instead of the raw folder listing.
   */
  segmentLinks: Record<string, string>
}

const defaultOptions: BreadcrumbOptions = {
  spacerSymbol: "❯",
  rootName: "Home",
  resolveFrontmatterTitle: true,
  showCurrentPage: true,
  omitSegments: [],
  segmentLabels: {},
  segmentLinks: {},
}

function formatCrumb(displayName: string, baseSlug: FullSlug, currentSlug: SimpleSlug): CrumbData {
  return {
    displayName: displayName.replaceAll("-", " "),
    path: resolveRelative(baseSlug, currentSlug),
  }
}

export default ((opts?: Partial<BreadcrumbOptions>) => {
  const options: BreadcrumbOptions = { ...defaultOptions, ...opts }
  const Breadcrumbs: QuartzComponent = ({
    fileData,
    allFiles,
    displayClass,
    ctx,
  }: QuartzComponentProps) => {
    const trie = (ctx.trie ??= trieFromAllFiles(allFiles))
    const slugParts = fileData.slug!.split("/")
    const pathNodes = trie.ancestryChain(slugParts)

    if (!pathNodes) {
      return null
    }

    const crumbs: CrumbData[] = pathNodes
      .map((node, idx) => {
        // The path segment this node represents (root has none).
        const segment = idx === 0 ? "" : slugParts[idx - 1]
        const isCurrent = idx === pathNodes.length - 1

        if (!isCurrent && segment && options.omitSegments.includes(segment)) {
          return null
        }

        const target = options.segmentLinks[segment]
        const crumb = target
          ? formatCrumb(node.displayName, fileData.slug!, simplifySlug(target as FullSlug))
          : formatCrumb(node.displayName, fileData.slug!, simplifySlug(node.slug))
        if (idx === 0) {
          crumb.displayName = options.rootName
        }
        if (segment && options.segmentLabels[segment]) {
          crumb.displayName = options.segmentLabels[segment]
        }

        // For last node (current page), set empty path
        if (isCurrent) {
          crumb.path = ""
        }

        return crumb
      })
      .filter((crumb): crumb is CrumbData => crumb !== null)

    if (!options.showCurrentPage) {
      crumbs.pop()
    }

    return (
      <nav class={classNames(displayClass, "breadcrumb-container")} aria-label="breadcrumbs">
        {crumbs.map((crumb, index) => (
          <div class="breadcrumb-element">
            <a href={crumb.path}>{crumb.displayName}</a>
            {index !== crumbs.length - 1 && <p>{` ${options.spacerSymbol} `}</p>}
          </div>
        ))}
      </nav>
    )
  }
  Breadcrumbs.css = breadcrumbsStyle

  return Breadcrumbs
}) satisfies QuartzComponentConstructor
