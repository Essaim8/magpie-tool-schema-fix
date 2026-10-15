// Magpie gateway middleware for yetone/magpie#2179.
// Completes missing object types in tool JSON Schemas before routing.
// Does not change explicitly typed schemas, unions, references, enums or consts.
//
// Scope: only the models named in ctx.options.models, so a model whose
// upstream is strict gets the fix and every other request passes through
// untouched. With no options set, DEFAULT_MODELS alone applies.

// DEFAULT_MODELS is what the middleware fixes with no options set: the
// models known to turn a turn away over an untyped tool schema. Add more
// with the plugin's Options ("models"), or "*" for every model.
const DEFAULT_MODELS = ["mirasim/gemini-4-argon"]

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

// optionList is an option given as an array or a comma-separated string,
// trimmed and without empties; null when it names nothing.
function optionList(value) {
  const raw = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : null
  if (raw === null) return null
  const out = raw.filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean)
  return out.length ? out : null
}

// matchesModel is whether name is named by pattern: "*" for any, a
// trailing "*" as a prefix, else an exact name. Case-insensitive, as model
// ids are.
function matchesModel(name, pattern) {
  const n = String(name).toLowerCase()
  const p = String(pattern).toLowerCase()
  if (p === "*") return true
  if (p.endsWith("*")) return n.startsWith(p.slice(0, -1))
  return n === p
}

// inScope is whether this request is one to fix: its model — as the agent
// asked (ctx.model) or as the body names it — is in the models option, or
// in DEFAULT_MODELS when the option is unset; an agents option, when set,
// must also name ctx.agent.
function inScope(body, ctx) {
  const options = isObject(ctx) && isObject(ctx.options) ? ctx.options : {}

  const models = optionList(options.models) || DEFAULT_MODELS
  const names = [ctx && ctx.model, body && body.model]
    .filter(name => typeof name === "string" && name)
  if (!names.some(name => models.some(pattern => matchesModel(name, pattern)))) {
    return false
  }

  const agents = optionList(options.agents)
  if (agents !== null) {
    const agent = ctx && typeof ctx.agent === "string" ? ctx.agent : ""
    if (!agents.some(pattern => matchesModel(agent, pattern))) return false
  }
  return true
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
  if (!inScope(body, ctx)) return body
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
