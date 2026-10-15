import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequest } from '../tool-schema-fix.middleware.js'

const copy = value => JSON.parse(JSON.stringify(value))

const schema = () => ({
  properties: {
    plain: { type: 'string' },
    nested: { required: ['item'], properties: { item: { type: 'number' } } },
    arr: { type: 'array', items: { properties: { x: { type: 'string' } } } },
  },
})

test('Responses: fixes missing type at root and nested object/array', () => {
  const body = { model: 'example', tools: [{ type: 'function', name: 'tool', parameters: schema() }] }
  const result = onRequest(body, {})
  assert.equal(result, body)
  const p = result.tools[0].parameters
  assert.equal(p.type, 'object')
  assert.equal(p.properties.nested.type, 'object')
  assert.equal(p.properties.arr.items.type, 'object')
  assert.equal(p.properties.plain.type, 'string')
})

test('Anthropic input_schema and Chat function.parameters', () => {
  const body = { tools: [
    { name: 'a', input_schema: schema() },
    { type: 'function', function: { name: 'b', parameters: schema() } },
  ] }
  onRequest(body, {})
  assert.equal(body.tools[0].input_schema.type, 'object')
  assert.equal(body.tools[1].function.parameters.type, 'object')
})

test('Responses namespace nested tools and supplemental tool definitions', () => {
  const body = {
    tools: [{ type: 'namespace', tools: [{ type: 'function', parameters: schema() }] }],
    additional_tools: [{ parameters: schema() }],
    input: [
      { type: 'additional_tools', tools: [{ parameters: schema() }] },
      { type: 'tool_search_output', tools: [{ parameters: schema() }] },
    ],
  }
  onRequest(body, {})
  assert.equal(body.tools[0].tools[0].parameters.type, 'object')
  assert.equal(body.additional_tools[0].parameters.type, 'object')
  assert.equal(body.input[0].tools[0].parameters.type, 'object')
  assert.equal(body.input[1].tools[0].parameters.type, 'object')
})

test('does not override explicit types or refs/unions/const/enums', () => {
  const children = {
    typed: { type: 'array', properties: { x: { type: 'string' } } },
    reference: { $ref: '#/$defs/A', properties: {} },
    any: { anyOf: [{ type: 'string' }, { properties: { a: {} } }], properties: {} },
    one: { oneOf: [{ type: 'string' }], properties: {} },
    all: { allOf: [{ type: 'object' }], properties: {} },
    constant: { const: 1, properties: {} },
    enumeration: { enum: ['a'], properties: {} },
  }
  const body = { tools: [{ parameters: { type: 'object', properties: children } }] }
  onRequest(body, {})
  for (const child of Object.values(children)) {
    assert.equal(child.type, child === children.typed ? 'array' : undefined)
  }
  assert.equal(children.any.anyOf[1].properties.a.type, undefined)
  assert.equal(children.any.anyOf[1].type, 'object')
})

test('unchanged schemas and idempotence', () => {
  const body = { tools: [{ parameters: { type: 'object', properties: { a: { type: 'string' } } } }] }
  const baseline = copy(body)
  onRequest(body, {})
  assert.deepEqual(body, baseline)
  onRequest(body, {})
  assert.deepEqual(body, baseline)
  const missing = { tools: [{ parameters: schema() }] }
  onRequest(missing, {})
  const once = copy(missing)
  onRequest(missing, {})
  assert.deepEqual(missing, once)
})

test('ignores missing/malformed bodies and unrelated values', () => {
  assert.equal(onRequest(null, {}), null)
  assert.equal(onRequest('hello', {}), 'hello')
  assert.deepEqual(onRequest({ tools: null, model: 'x' }, {}), { tools: null, model: 'x' })
})
