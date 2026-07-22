import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

/**
 * Quartz 4 Configuration
 *
 * See https://quartz.jzhao.xyz/configuration for more information.
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "Courses — BNDS A-Level Programme",
    pageTitleSuffix: "",
    enableSPA: true,
    enablePopovers: true,
    // No third-party analytics: this is a student-facing site.
    analytics: null,
    locale: "en-US",
    baseUrl: "courses.dogan.education",
    // Cloud-sync conflict copies ("index 2.md") can appear in content/ between a
    // sync and a build, bypassing the filter. sync.mjs prunes them; this catches
    // any that land in the gap.
    ignorePatterns: ["private", "templates", ".obsidian", "**/* [0-9]", "**/*conflicted copy*"],
    defaultDateType: "modified",
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        // Fraunces is a variable display serif — warmth and real presence at
        // large sizes. Inter carries the body because this content is dense with
        // tables, where a serif gets noisy at small sizes.
        header: "Fraunces",
        body: "Inter",
        code: "IBM Plex Mono",
      },
      colors: {
        lightMode: {
          light: "#fdfcfa",
          lightgray: "#e7e2d9",
          gray: "#a49d92",
          darkgray: "#55504a",
          dark: "#1c1a17",
          secondary: "#8a3324",
          tertiary: "#b4674c",
          highlight: "rgba(138, 51, 36, 0.07)",
          textHighlight: "#e8c9a088",
        },
        darkMode: {
          light: "#171614",
          lightgray: "#312d27",
          gray: "#726c62",
          darkgray: "#c6c0b5",
          dark: "#efebe3",
          secondary: "#d99a7c",
          tertiary: "#b4674c",
          highlight: "rgba(217, 154, 124, 0.09)",
          textHighlight: "#b3aa0288",
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.FrontMatter(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "git", "filesystem"],
      }),
      Plugin.SyntaxHighlighting({
        theme: {
          light: "github-light",
          dark: "github-dark",
        },
        keepBackground: false,
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }),
      Plugin.Description(),
      Plugin.Latex({ renderEngine: "katex" }),
    ],
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      Plugin.FolderPage(),
      // No TagPage: the vault's tags are teacher taxonomy (cie-9607, lesson-plan),
      // and sync.mjs strips them from published frontmatter anyway.
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.Favicon(),
      Plugin.NotFoundPage(),
      // Comment out CustomOgImages to speed up build time
      Plugin.CustomOgImages(),
    ],
  },
}

export default config
