# Magpie Tool Schema Fix

[简体中文](#中文说明) | [English](#english)

A lightweight Magpie gateway middleware that fills in `"type": "object"` for untyped **object-shaped tool parameter schemas** before Magpie routes and translates requests. A temporary workaround for [yetone/magpie#2179](https://github.com/yetone/magpie/issues/2179).

## 中文说明

### 解决什么问题

Codex Desktop 的部分 `codex_app` 工具定义中，JSON Schema 可能包含 `properties` / `required`，但没有声明 `type`。部分严格校验工具定义的上游会拒绝整个请求，通常表现为 HTTP 400 `invalid_request_error`。该中间件在 Magpie 的 `onRequest` 阶段递归补齐对象 Schema 的类型。

- 处理 Responses、Chat Completions、Anthropic Messages 中的工具定义，以及 Responses namespace 的子工具。
- 处理嵌套 `properties` 和数组 `items` 内的对象。
- 已有显式 `type` 的 Schema 保持不变；`$ref`、组合 Schema、`const` 和 `enum` 不强行推断类型。
- 无第三方运行时依赖；不会发送数据到外部服务。

### 安装

在 Magpie 的「插件 → 发现 → 非官方插件 · GitHub」中找到本仓库并安装（仓库需要带有 `magpie-plugin` GitHub Topic）；或运行：

```sh
magpie plugin add github:Essaim8/magpie-tool-schema-fix
```

也可以下载仓库到本地后执行 `magpie plugin add ./magpie-tool-schema-fix`。在「插件 → 已安装」中确认中间件开启。

### 使用及限制

此插件仅修改 **Magpie 接收的原始请求体**，发生在路由和协议转换之前；它不能修复 Magpie 在后续协议转换中**新产生的**无类型 Schema。因此，与 #2179 在最终上游发送位置实施的原生补丁相比，覆盖范围不同。是否能解决特定上游环境的 400，需要在实际 Codex + Magpie 环境中验证。修复随 Magpie 正式版本发布后建议移除本临时中间件。

执行测试：`npm test`（仅使用 Node.js 内置测试运行器，不会安装依赖）。

## English

Magpie gateway middleware for untyped object-like JSON Schemas in tool parameters. It recursively fills in missing `"type": "object"` for object shapes and preserves existing types, unions, `$ref`, enum and const schemas.

Install with `magpie plugin add github:Essaim8/magpie-tool-schema-fix`, or use the Magpie Plugins Discover page once the repository is indexed under the `magpie-plugin` GitHub topic. No npm publication is required.

**Scope:** Runs in `onRequest` *before* routing/translation. It cannot fix schemas newly introduced *by* a downstream protocol converter. This is an experimental workaround, not a confirmed replacement for the upstream patch. See [issue #2179](https://github.com/yetone/magpie/issues/2179).

Tests: `npm test` with Node.js.

## License

MIT.
