export default `
; High-level Markdown structure

; Sections group a heading with its content
(section) @markdown.section

; Standalone headings
(atx_heading) @markdown.heading
(setext_heading) @markdown.heading

; Fenced code blocks
(fenced_code_block) @markdown.code_block

; Lists (ordered and unordered)
(list) @markdown.list
`

