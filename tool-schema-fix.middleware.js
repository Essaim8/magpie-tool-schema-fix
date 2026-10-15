// Magpie gateway middleware for yetone/magpie#2179.
// Completes missing object types in tool JSON Schemas before routing.
// Does not change explicitly typed schemas, unions, references, enums or consts.

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function visitSchema(schema) {
  if (!isObject(schema)) return

  const objectShape = isObject(schema.properties) || Array.isArray(schema.required)
  const alternateShape =
    "$ref" in schema || "anyOf" in schema || "oneOf" in schema ||
    "allOf" in schema || "const" in schema || "enum" in schema

  if (schema.type == null && objectShape && !alternateShape) {
    schema.type = "object"
  }

  for (const field of ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]) {
    if (isObject(schema[field])) {
      for (const child of Object.values(schema[field])) visitSchema(child)
    }
  }

  for (const field of ["items", "additionalProperties", "not", "if", "then", "else", "contains"]) {
    visitSchema(schema[field])
  }

  for (const field of ["prefixItems", "anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(schema[field])) {
      for (const child of schema[field]) visitSchema(child)
    }
  }
}

function visitTool(tool) {
  if (!isObject(tool)) return
  visitSchema(tool.parameters)                   // Responses: function tool
  visitSchema(tool.input_schema)                 // Anthropic Messages
  if (isObject(tool.function)) {
    visitSchema(tool.function.parameters)        // Chat Completions
  }
  if (Array.isArray(tool.tools)) {               // Responses: namespace tools
    for (const nested of tool.tools) visitTool(nested)
  }
}

export function onRequest(body, ctx) {
  if (!isObject(body)) return body
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) visitTool(tool)
  }
  if (Array.isArray(body.additional_tools)) {
    for (const tool of body.additional_tools) visitTool(tool)
  }
  // Tool definitions can also arrive in a Responses Lite input item.
  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (isObject(item) && (item.type === "additional_tools" || item.type === "tool_search_output")) {
        if (Array.isArray(item.tools)) {
          for (const tool of item.tools) visitTool(tool)
        }
      }
    }
  }
  return body
}
