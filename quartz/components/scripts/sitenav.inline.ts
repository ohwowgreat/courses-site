// Mobile Menu toggle for the site nav. The button only renders visibly below
// the mobile breakpoint; opening it also reveals the page TOC, which sits after
// the nav in the left rail (see the .site-nav.open ~ .toc rule in custom.scss).
function setupSiteNav() {
  for (const nav of document.getElementsByClassName("site-nav")) {
    const button = nav.querySelector(".site-nav-toggle")
    if (!button) continue
    const toggle = () => {
      const open = nav.classList.toggle("open")
      button.setAttribute("aria-expanded", open ? "true" : "false")
    }
    button.addEventListener("click", toggle)
    window.addCleanup(() => button.removeEventListener("click", toggle))
  }
}

document.addEventListener("nav", setupSiteNav)
