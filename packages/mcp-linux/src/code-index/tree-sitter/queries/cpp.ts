export default `
; C++ namespaces, classes, templates and functions

(namespace_definition) @cpp.namespace

(class_specifier) @cpp.class

(struct_specifier) @cpp.struct

(template_declaration) @cpp.template

(function_definition) @cpp.function
`

