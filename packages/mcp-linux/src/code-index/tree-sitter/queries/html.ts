export default `
; HTML structural elements

; Generic element (div, span, etc.). Smaller elements will be filtered by length.
(element) @html.element

; Script and style regions
(script_element) @html.script
(style_element) @html.style
`

