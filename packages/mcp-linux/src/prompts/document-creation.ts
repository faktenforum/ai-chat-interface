/**
 * MCP Prompt: Document Creation
 *
 * LLM-optimized reference for creating professional documents
 * using Typst (PDF) and Pandoc (editable formats).
 */

export const DOCUMENT_CREATION_PROMPT = {
  name: 'document_creation',
  description: 'Complete reference for creating documents: Typst syntax for PDF generation, Pandoc for editable formats (ODT/DOCX), templates for letters, reports, invoices, CVs',
  content: `# Document Creation

## Workflow

1. **Clarify** — type (letter, report, invoice, CV...), content, style, language.
2. **Write source** — \`.typ\` file for PDF, or \`.md\` for editable formats.
3. **Compile** — \`typst compile document.typ document.pdf\` or \`pandoc document.md -o document.odt\`.
4. **Return** — \`read_workspace_file\` (PDF shown as preview) or \`create_download_link\`.

---

## Typst — PDF Generation

Typst is a modern markup-based typesetting system. Single binary, fast compilation, no LaTeX needed.

### Compile

\`\`\`bash
typst compile document.typ document.pdf
# Watch mode (re-compile on change):
typst watch document.typ document.pdf
# List available fonts:
typst fonts
\`\`\`

### Page Setup

\`\`\`typst
#set page(paper: "a4", margin: (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm))
#set page(numbering: "1")           // page numbers
#set page(header: align(right)[My Document])
#set page(footer: align(center)[Page #counter(page).display()])
\`\`\`

### Text & Font

\`\`\`typst
#set text(font: "DejaVu Sans", size: 11pt, lang: "de")
#set par(justify: true, leading: 0.65em)  // justified text, line spacing
\`\`\`

Available fonts: DejaVu Sans, DejaVu Serif, DejaVu Sans Mono (from fonts-dejavu-core). Check with \`typst fonts\`.

### Headings

\`\`\`typst
= Heading 1
== Heading 2
=== Heading 3
\`\`\`

### Text Formatting

\`\`\`typst
*bold text*
_italic text_
*_bold italic_*
\`inline code\`
#underline[underlined text]
#strike[strikethrough]
#smallcaps[small caps]
#super[superscript]
#sub[subscript]
\`\`\`

### Lists

\`\`\`typst
// Bullet list
- Item one
- Item two
  - Nested item

// Numbered list
+ First
+ Second
+ Third

// Description list
/ Term: Definition here
/ Another: Its definition
\`\`\`

### Links & References

\`\`\`typst
#link("https://example.com")[Click here]
#link("mailto:info@example.com")
See @introduction           // reference a label
= Introduction <introduction>  // label a heading
\`\`\`

### Images

\`\`\`typst
#image("logo.png", width: 50%)
#figure(
  image("chart.png", width: 80%),
  caption: [Sales overview 2024],
)
\`\`\`

### Tables

\`\`\`typst
#table(
  columns: (auto, 1fr, 1fr),
  align: (left, right, right),
  table.header(
    [Item], [Quantity], [Price],
  ),
  [Widget], [10], [€ 5.00],
  [Gadget], [3], [€ 12.50],
)
\`\`\`

### Spacing & Layout

\`\`\`typst
#v(1cm)                   // vertical space
#h(1cm)                   // horizontal space
#align(center)[Centered text]
#align(right)[Right-aligned]
#align(center + horizon)[Vertically + horizontally centered]
\\                          // line break
#linebreak()              // explicit line break
#pagebreak()              // page break
#colbreak()               // column break
#line(length: 100%)       // horizontal rule
\`\`\`

### Columns

\`\`\`typst
#columns(2, gutter: 1cm)[
  Left column content.
  #colbreak()
  Right column content.
]
\`\`\`

### Boxes & Blocks

\`\`\`typst
#box(fill: luma(230), inset: 8pt, radius: 4pt)[
  Highlighted content in a box.
]

#block(fill: rgb("#e8f4f8"), inset: 12pt, radius: 4pt, width: 100%)[
  A full-width info block.
]

#rect(width: 100%, inset: 8pt, stroke: 0.5pt)[
  Content with border.
]
\`\`\`

### Code Blocks

\`\`\`typst
// Inline code
\`let x = 42\`

// Code block
\\\`\\\`\\\`python
def hello():
    print("Hello, World!")
\\\`\\\`\\\`

// Raw block (no syntax highlighting)
#raw(block: true, lang: "python", "def hello():\\n    print('Hello')")
\`\`\`

### Math

\`\`\`typst
Inline: $x^2 + y^2 = z^2$

Block:
$ sum_(k=0)^n k = (n(n+1)) / 2 $
\`\`\`

### Variables & Logic

\`\`\`typst
#let company = "ACME Corp"
#let total = 150.00
#let items = ("Widget", "Gadget", "Doohickey")

Company: #company \\
Total: €#total

#if total > 100 [
  Large order — free shipping!
] else [
  Shipping: €5.00
]

#for item in items [
  - #item
]
\`\`\`

### Data Import

\`\`\`typst
#let data = csv("data.csv")
#let config = json("config.json")
#let markup = yaml("meta.yaml")

// CSV to table
#table(
  columns: data.first().len(),
  ..data.flatten(),
)
\`\`\`

### Show/Set Rules (Global Styling)

\`\`\`typst
// All headings in blue
#show heading: set text(fill: blue)

// Custom heading style
#show heading.where(level: 1): it => {
  set text(size: 18pt, weight: "bold")
  v(0.5cm)
  it.body
  v(0.3cm)
  line(length: 100%, stroke: 0.5pt)
}

// Links in blue with underline
#show link: set text(fill: blue)
#show link: underline
\`\`\`

### Table of Contents

\`\`\`typst
#outline()                 // auto-generated TOC
#outline(depth: 2)         // limit to 2 levels
\`\`\`

---

## Template: Letter (DIN 5008 style)

\`\`\`typst
#set page(paper: "a4", margin: (top: 2.7cm, bottom: 2.5cm, left: 2.5cm, right: 2cm))
#set text(font: "DejaVu Sans", size: 11pt, lang: "de")
#set par(justify: true, leading: 0.65em)

// Sender (right-aligned)
#align(right)[
  Max Mustermann \\
  Musterstraße 1 \\
  12345 Musterstadt \\
  #link("mailto:max@example.com") \\
  +49 123 456789
]

#v(1.5cm)

// Recipient
Firma GmbH \\
z. Hd. Frau Schmidt \\
Beispielweg 42 \\
54321 Beispielstadt

#v(1cm)

// Date (right-aligned)
#align(right)[Musterstadt, 10. Februar 2026]

#v(1cm)

// Subject
*Betreff: Anfrage zur Zusammenarbeit*

#v(0.5cm)

Sehr geehrte Frau Schmidt,

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

#v(0.5cm)

Mit freundlichen Grüßen

#v(1cm)

Max Mustermann
\`\`\`

## Template: Report

\`\`\`typst
#set page(paper: "a4", margin: 2.5cm, numbering: "1")
#set text(font: "DejaVu Serif", size: 11pt, lang: "de")
#set par(justify: true, leading: 0.65em)
#set heading(numbering: "1.1")

// Title page
#align(center + horizon)[
  #text(size: 24pt, weight: "bold")[Projektbericht 2026]

  #v(1cm)

  #text(size: 14pt)[Abteilung Forschung & Entwicklung]

  #v(2cm)

  #text(size: 12pt)[
    Max Mustermann \\
    ACME Corp \\
    10. Februar 2026
  ]
]

#pagebreak()

// Table of contents
#outline(depth: 2)
#pagebreak()

// Content
= Einleitung

Lorem ipsum dolor sit amet, consectetur adipiscing elit.

== Hintergrund

Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

= Methodik

Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.

= Ergebnisse

#figure(
  table(
    columns: 3,
    table.header([Metrik], [Q1], [Q2]),
    [Umsatz], [€ 120k], [€ 145k],
    [Kunden], [320], [385],
  ),
  caption: [Quartalsergebnisse],
)

= Fazit

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.
\`\`\`

## Template: Invoice

\`\`\`typst
#set page(paper: "a4", margin: 2.5cm)
#set text(font: "DejaVu Sans", size: 10pt, lang: "de")

#let invoice_nr = "2026-0042"
#let invoice_date = "10.02.2026"
#let due_date = "10.03.2026"
#let tax_rate = 19

#let items = (
  (desc: "Webdesign", qty: 1, price: 2500.00),
  (desc: "Hosting (12 Monate)", qty: 12, price: 9.99),
  (desc: "SEO-Optimierung", qty: 5, price: 150.00),
)

// Header
#grid(
  columns: (1fr, 1fr),
  align(left)[
    *ACME Corp* \\
    Musterstraße 1 \\
    12345 Musterstadt
  ],
  align(right)[
    Rechnungsnr.: *#invoice_nr* \\
    Datum: #invoice_date \\
    Fällig: #due_date
  ],
)

#v(1.5cm)

// Recipient
Kunde GmbH \\
Beispielweg 42 \\
54321 Beispielstadt

#v(1.5cm)

#text(size: 16pt, weight: "bold")[Rechnung #invoice_nr]

#v(0.5cm)

// Items table
#let subtotal = items.map(i => i.qty * i.price).sum()
#let tax = subtotal * tax_rate / 100
#let total = subtotal + tax

#table(
  columns: (1fr, auto, auto, auto),
  align: (left, center, right, right),
  table.header(
    [*Beschreibung*], [*Menge*], [*Einzelpreis*], [*Gesamt*],
  ),
  ..items.map(i => (
    i.desc,
    str(i.qty),
    [€ #calc.round(i.price, digits: 2)],
    [€ #calc.round(i.qty * i.price, digits: 2)],
  )).flatten(),
)

#v(0.3cm)

#align(right)[
  #table(
    columns: (auto, auto),
    align: (left, right),
    stroke: none,
    [Zwischensumme:], [€ #calc.round(subtotal, digits: 2)],
    [MwSt. (#tax_rate%):], [€ #calc.round(tax, digits: 2)],
    table.hline(),
    [*Gesamtbetrag:*], [*€ #calc.round(total, digits: 2)*],
  )
]

#v(1cm)

Zahlbar innerhalb von 30 Tagen. Bankverbindung: IBAN DE89 3704 0044 0532 0130 00.
\`\`\`

---

## Pandoc — Editable Formats

When the user wants an **editable** document (not PDF), write Markdown and convert with Pandoc.

\`\`\`bash
# Markdown → ODT (recommended open format)
pandoc document.md -o document.odt

# Markdown → DOCX
pandoc document.md -o document.docx

# Markdown → HTML (standalone)
pandoc document.md -s -o document.html

# Markdown → EPUB
pandoc document.md -o document.epub

# With custom styling (provide a template)
pandoc document.md --reference-doc=template.odt -o document.odt
\`\`\`

**Format preference:** Prefer ODT as the recommended open editable format. Offer DOCX as alternative for Microsoft Office users.

---

## Constraints

- **PDF** — always use Typst (\`typst compile\`). Do not use LaTeX or wkhtmltopdf.
- **Editable** — use Pandoc for ODT/DOCX/HTML/EPUB.
- **Fonts** — DejaVu Sans, DejaVu Serif, DejaVu Sans Mono are available. Check with \`typst fonts\`.
- **Images in documents** — save images in workspace first, reference by relative path.
- **Output** — save in workspace; return via \`read_workspace_file\` (PDF preview) or \`create_download_link\`.
- **Language** — match the user's language in document content; keep code/comments in English.
`,
};
