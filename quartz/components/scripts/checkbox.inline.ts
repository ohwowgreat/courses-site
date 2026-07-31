import { getFullSlug } from "../../util/path"

const checkboxId = (index: number) => `${getFullSlug(window)}-checkbox-${index}`

// A progress track under every task list, matching the study guide's checklists. Built
// here rather than written into the markdown by sync.mjs because the count is a runtime
// fact — CSS cannot count checked siblings, and a bar baked into the page would ship a
// permanent "0 of 7" over a half-ticked list.
function updateBar(list: HTMLElement) {
  // :scope > li > so a nested list is not counted twice into its parent's total.
  const boxes = list.querySelectorAll<HTMLInputElement>(":scope > li > input.checkbox-toggle")
  // One box is a stray task inside a prose list, not a checklist worth a track.
  if (boxes.length < 2) return
  const done = Array.from(boxes).filter((b) => b.checked).length

  let bar = list.nextElementSibling as HTMLElement | null
  if (!bar?.classList.contains("cl-bar")) {
    bar = document.createElement("div")
    bar.className = "cl-bar"
    bar.setAttribute("role", "progressbar")
    bar.setAttribute("aria-valuemin", "0")
    bar.appendChild(document.createElement("i"))
    const label = document.createElement("p")
    label.className = "cl-lab"
    // The SPA swaps the whole article on navigation, so these go with it and need no
    // cleanup. The classList guard above is what stops a repeated `nav` stacking a
    // second track under the same list.
    list.after(bar, label)
  }
  const label = bar.nextElementSibling as HTMLElement
  ;(bar.firstElementChild as HTMLElement).style.width = `${(done / boxes.length) * 100}%`
  bar.setAttribute("aria-valuemax", String(boxes.length))
  bar.setAttribute("aria-valuenow", String(done))
  label.textContent = `${done} of ${boxes.length} complete`
}

document.addEventListener("nav", () => {
  const checkboxes = document.querySelectorAll(
    "input.checkbox-toggle",
  ) as NodeListOf<HTMLInputElement>
  const lists = new Set<HTMLElement>()

  checkboxes.forEach((el, index) => {
    const elId = checkboxId(index)
    const list = el.closest("ul")

    const switchState = (e: Event) => {
      const newCheckboxState = (e.target as HTMLInputElement)?.checked ? "true" : "false"
      localStorage.setItem(elId, newCheckboxState)
      if (list) updateBar(list)
    }

    el.addEventListener("change", switchState)
    window.addCleanup(() => el.removeEventListener("change", switchState))
    if (localStorage.getItem(elId) === "true") {
      el.checked = true
    }
    if (list) lists.add(list)
  })

  // After the restore loop, never inside it: the first list's bar has to count the last
  // box's restored state, not the state it had when the loop reached it.
  lists.forEach(updateBar)
})
