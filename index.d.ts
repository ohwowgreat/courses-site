declare module "*.scss" {
  const content: string
  export = content
}

// Plain-JS module shared between the publish pipeline and SiteNav.
declare module "*course-map.mjs" {
  export function classify(
    rel: string,
    title: string,
  ): {
    group: "calendar" | "assessments" | "lessons" | "units" | "plans" | "more"
    label: string
    sort: number
    tip?: string
    sem?: number
    n?: number
    name?: string
    base?: string
  } | null
  export function courseMapHtml(
    items: { rel: string; title: string; unit?: string }[],
    dir: string,
  ): string
}

// dom custom event
interface CustomEventMap {
  prenav: CustomEvent<{}>
  nav: CustomEvent<{ url: FullSlug }>
  themechange: CustomEvent<{ theme: "light" | "dark" }>
  readermodechange: CustomEvent<{ mode: "on" | "off" }>
}

type ContentIndex = Record<FullSlug, ContentDetails>
declare const fetchData: Promise<ContentIndex>
