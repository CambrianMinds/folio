#set page(
  width: pw, height: ph,
  margin: if c.mirrored { (top: c.marginTop * 1pt, bottom: c.marginBottom * 1pt, inside: c.marginLeft * 1pt, outside: c.marginRight * 1pt) } else { (top: c.marginTop * 1pt, bottom: c.marginBottom * 1pt, left: c.marginLeft * 1pt, right: c.marginRight * 1pt) },
  fill: rgb(c.background), columns: c.columns,
  header: if c.header != "" { text(size: 8pt, c.header) },
  footer: context {
    if c.footer != "" { align(left, text(size: 8pt, c.footer)) }
    if c.pageNumbers { align(right, text(size: 8pt, counter(page).display("1"))) }
  },
  foreground: context {
    if c.rule and c.columns > 1 {
      let ends = query(<folio-title-end>)
      let top-edge = c.marginTop * 1pt
      if ends.len() > 0 {
        let pos = ends.first().location().position()
        if pos.page == here().page() { top-edge = calc.max(top-edge, pos.y + 16pt) }
      }
      let left-edge = if c.mirrored and calc.even(here().page()) { c.marginRight } else { c.marginLeft }
      let usable = pw - (c.marginLeft + c.marginRight) * 1pt
      let cw = (usable - (c.columns - 1) * c.gutter * 1pt) / c.columns
      let y = top-edge + c.ruleInsetTop * 1pt
      let bottom-edge = ph - (c.marginBottom + c.ruleInsetBottom) * 1pt
      if bottom-edge > y {
        for i in range(1, c.columns) {
          let x = left-edge * 1pt + i * cw + (i - 0.5) * c.gutter * 1pt
          place(top + left, dx: x, dy: y, line(length: bottom-edge - y, angle: 90deg, stroke: (paint: rgb(c.ruleColor), thickness: c.ruleWidth * 1pt)))
        }
      }
    }
  },
)
#set columns(gutter: c.gutter * 1pt)
#set text(font: (c.bodyFont, "Libertinus Serif"), size: c.fontSize * 1pt, fill: rgb(c.textColor), lang: "en")
// The inspector's paragraph spacing is EXTRA space above the normal line gap.
// Typst's native spacing replaces leading; passing zero directly overlaps ink.
#set block(spacing: c.leading * 1em + c.paragraphSpacing * 1pt)
#set par(justify: c.justify, leading: c.leading * 1em, spacing: c.leading * 1em + c.paragraphSpacing * 1pt, first-line-indent: c.indent * 1pt)
#show heading: it => block(above: 1.1em, below: 0.55em, sticky: true, text(font: (c.headingFont, "Libertinus Serif"), fill: rgb(c.headingColor), weight: "bold", size: c.fontSize * calc.pow(c.headingScale, 4 - calc.min(it.level, 4)) * 1pt, it.body))
#show link: set text(fill: rgb(c.linkColor))
#show raw: set text(font: ("Consolas", "DejaVu Sans Mono"), size: c.codeSize * 1pt)
#show raw.where(block: true): it => block(width: 100%, inset: 6pt, fill: rgb("f1f1ee"), breakable: true, it)
#show quote.where(block: true): it => block(inset: (left: 12pt), stroke: (left: 0.7pt + rgb(c.ruleColor)), it.body)
#set table(inset: 4pt, stroke: 0.4pt + rgb(c.ruleColor))
#show table: set text(size: c.fontSize * 0.85pt)
#set figure(gap: c.figureSpacing * 1pt)
#show figure.caption: set text(size: c.fontSize * 0.85pt)
#set image(width: 100%)
#let horizontalrule = line(length: 100%, stroke: 0.5pt + rgb(c.ruleColor))
#let horizontalRule = horizontalrule
#let divider() = horizontalrule

