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

// The models the middleware fixes by default.
const ctx = (extra = {}) => ({ model: 'mirasim/gemini-4-argon', ...extra })

test('Responses: fixes missing type at root and nested object/array', () => {
  const body = { model: 'mirasim/gemini-4-argon', tools: [{ type: 'function', name: 'tool', parameters: schema() }] }
  const result = onRequest(body, ctx())
  assert.equal(result, body)
  const p = result.tools[0].parameters
  assert.equal(p.type, 'object')
  assert.equal(p.properties.nested.type, 'object')
  assert.equal(p.properties.arr.items.type, 'object')
  assert.equal(p.properties.plain.type, 'string')
})

test('Anthropic input_schema and Chat function.parameters', () => {
  const body = { model: 'mirasim/gemini-4-argon', tools: [
    { name: 'a', input_schema: schema() },
    { type: 'function', function: { name: 'b', parameters: schema() } },
  ] }
  onRequest(body, ctx())
  assert.equal(body.tools[0].input_schema.type, 'object')
  assert.equal(body.tools[1].function.parameters.type, 'object')
})

test('Responses namespace nested tools and supplemental tool definitions', () => {
  const body = {
    model: 'mirasim/gemini-4-argon',
    tools: [{ type: 'namespace', tools: [{ type: 'function', parameters: schema() }] }],
    additional_tools: [{ parameters: schema() }],
    input: [
      { type: 'additional_tools', tools: [{ parameters: schema() }] },
      { type: 'tool_search_output', tools: [{ parameters: schema() }] },
      { type: 'message', content: [{ type: 'input_text', text: 'hi' }] },
    ],
  }
  onRequest(body, ctx())
  assert.equal(body.tools[0].tools[0].parameters.type, 'object')
  assert.equal(body.additional_tools[0].parameters.type, 'object')
  assert.equal(body.input[0].tools[0].parameters.type, 'object')
  assert.equal(body.input[1].tools[0].parameters.type, 'object')
})

test('does not override explicit types or refs/unions/const/enums', () => {
  const body = { model: 'mirasim/gemini-4-argon', tools: [{ parameters: {
    properties: {
      typed: { type: 'object', properties: { a: { type: 'string' } } },
      ref: { $ref: '#/$defs/x' },
      union: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      one: { oneOf: [{ type: 'object', properties: {} }] },
      all: { allOf: [{ type: 'object', properties: {} }] },
      constant: { const: 'x' },
      enumerated: { enum: ['a', 'b'] },
    },
    $defs: { x: { type: 'object', properties: { b: { type: 'string' } } } },
  } }] }
  const before = copy(body)
  onRequest(body, ctx())
  assert.deepEqual(body.tools[0].parameters.properties.ref, before.tools[0].parameters.properties.ref)
  assert.deepEqual(body.tools[0].parameters.properties.union, before.tools[0].parameters.properties.union)
  assert.deepEqual(body.tools[0].parameters.properties.one, before.tools[0].parameters.properties.one)
  assert.deepEqual(body.tools[0].parameters.properties.all, before.tools[0].parameters.properties.all)
  assert.deepEqual(body.tools[0].parameters.properties.constant, before.tools[0].parameters.properties.constant)
  assert.deepEqual(body.tools[0].parameters.properties.enumerated, before.tools[0].parameters.properties.enumerated)
  assert.equal(body.tools[0].parameters.type, 'object')
  // a $defs entry that is object-shaped and names no type is still fixed
  assert.equal(body.tools[0].parameters.$defs.x.type, 'object')
})

test('unchanged schemas and idempotence', () => {
  const body = { model: 'mirasim/gemini-4-argon', tools: [{ parameters: {
    type: 'object',
    properties: { a: { type: 'string' } },
  } }] }
  const before = copy(body)
  onRequest(body, ctx())
  assert.deepEqual(body, before)
  const fixed = { model: 'mirasim/gemini-4-argon', tools: [{ parameters: schema() }] }
  onRequest(fixed, ctx())
  const once = copy(fixed)
  onRequest(fixed, ctx())
  assert.deepEqual(fixed, once)
})

test('ignores missing/malformed bodies and unrelated values', () => {
  assert.equal(onRequest(null, ctx()), null)
  assert.equal(onRequest('x', ctx()), 'x')
  assert.equal(onRequest(42, ctx()), 42)
  assert.deepEqual(onRequest({ model: 'mirasim/gemini-4-argon' }, ctx()), { model: 'mirasim/gemini-4-argon' })
})

test('default scope: every other model passes through untouched', () => {
  for (const model of ['gpt-6.1-sol', 'codex/gpt-6-astra', 'claude-opus-5-5', 'deepseek/deepseek-v4.1-flash', 'kimi-k3', 'antigravity/gemini-3.8-flash']) {
    const body = { model, tools: [{ type: 'function', parameters: schema() }] }
    const before = copy(body)
    assert.equal(onRequest(body, ctx({ model })), body)
    assert.deepEqual(body, before, `${model} was modified`)
  }
})

test('models option: exact names, prefixes and wildcard', () => {
  const fix = 'mirasim/gemini-4-argon'
  // an exact list that does not name the model leaves it alone
  let body = { model: fix, tools: [{ parameters: schema() }] }
  const untouched = copy(body)
  onRequest(body, { model: fix, options: { models: ['other/model'] } })
  assert.deepEqual(body, untouched)

  // a comma-separated string names one
  body = { model: fix, tools: [{ parameters: schema() }] }
  onRequest(body, { model: fix, options: { models: 'other/model, ' + fix } })
  assert.equal(body.tools[0].parameters.type, 'object')

  // a prefix wildcard covers a family
  body = { model: 'some-vendor/strict-1', tools: [{ parameters: schema() }] }
  onRequest(body, { model: 'some-vendor/strict-1', options: { models: ['some-vendor/*'] } })
  assert.equal(body.tools[0].parameters.type, 'object')

  // "*" covers every model, which the default does not
  body = { model: 'gpt-6.1-sol', tools: [{ parameters: schema() }] }
  onRequest(body, { model: 'gpt-6.1-sol', options: { models: '*' } })
  assert.equal(body.tools[0].parameters.type, 'object')

  // an empty list falls back to the defaults
  body = { model: fix, tools: [{ parameters: schema() }] }
  onRequest(body, { model: fix, options: { models: [] } })
  assert.equal(body.tools[0].parameters.type, 'object')
})

test('agents option narrows to a client', () => {
  const fix = 'mirasim/gemini-4-argon'
  let body = { model: fix, tools: [{ parameters: schema() }] }
  const untouched = copy(body)
  onRequest(body, { model: fix, agent: 'dsh', options: { agents: ['codex'] } })
  assert.deepEqual(body, untouched)

  body = { model: fix, tools: [{ parameters: schema() }] }
  onRequest(body, { model: fix, agent: 'codex', options: { agents: ['codex'] } })
  assert.equal(body.tools[0].parameters.type, 'object')

  // no agents option: every client is in scope for an in-scope model
  body = { model: fix, tools: [{ parameters: schema() }] }
  onRequest(body, { model: fix, agent: 'dsh' })
  assert.equal(body.tools[0].parameters.type, 'object')
})

test('matches the model from the body when ctx names none', () => {
  const body = { model: 'mirasim/gemini-4-argon', tools: [{ parameters: schema() }] }
  onRequest(body, {}) // no ctx.model
  assert.equal(body.tools[0].parameters.type, 'object')
})
