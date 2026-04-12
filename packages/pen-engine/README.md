# @zseven-w/pen-engine

Headless design engine for [OpenPencil](https://github.com/nicepkg/openpencil) — framework-free document management, selection, history, and viewport.

## Install

```bash
npm install @zseven-w/pen-engine
```

## Features

- **Document management** — load, save, and manipulate `.op` design files
- **Selection engine** — multi-select, marquee, and hit-testing
- **History (undo/redo)** — immutable state snapshots with branching support
- **Viewport** — pan, zoom, and coordinate transforms
- **Framework-free** — zero React/Vue/Svelte dependency; bring your own UI

## Usage

```typescript
import { createEngine } from '@zseven-w/pen-engine';

const engine = createEngine();
engine.loadDocument(doc);
engine.select(['node-1', 'node-2']);
engine.undo();
```

## License

MIT
