# @zseven-w/pen-mcp

MCP (Model Context Protocol) server for [OpenPencil](https://github.com/nicepkg/openpencil) — enables external LLMs to read, create, and modify designs.

## Install

```bash
npm install @zseven-w/pen-mcp
```

## Features

- **Document tools** — `open_document`, `batch_get`, `snapshot_layout`, `get_selection`, page management
- **Node CRUD** — `insert_node`, `update_node`, `delete_node`, `move_node`, `copy_node`, `replace_node`
- **Batch design DSL** — compact multi-operation language: `I()`, `U()`, `D()`, `M()`, `C()`, `R()`
- **Layered generation** — `design_skeleton` / `design_content` / `design_refine` phased workflow
- **Design prompts** — segmented design knowledge for context-efficient AI generation
- **Live canvas sync** — real-time bidirectional sync with the desktop app

## Usage

```bash
# Run as MCP server (stdio transport)
npx @zseven-w/pen-mcp

# Or connect to a running OpenPencil instance
op mcp:dev
```

## License

MIT
