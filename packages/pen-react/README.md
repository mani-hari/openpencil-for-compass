# @zseven-w/pen-react

React UI SDK for [OpenPencil](https://github.com/nicepkg/openpencil) — hooks, components, and state bridges for pen-engine.

## Install

```bash
npm install @zseven-w/pen-react
```

## Features

- **DesignProvider** — context provider wiring pen-engine to React
- **DesignCanvas** — drop-in canvas component with Skia/CanvasKit rendering
- **Hooks** — `useDocument`, `useSelection`, `useViewport`, `useHistory`, and more
- **Panels** — layer panel, property panel, toolbar, and other editor UI primitives
- **Zustand stores** — reactive document and canvas state management

## Usage

```tsx
import { DesignProvider, DesignCanvas } from '@zseven-w/pen-react';

function Editor() {
  return (
    <DesignProvider>
      <DesignCanvas />
    </DesignProvider>
  );
}
```

## License

MIT
