# @zseven-w/pen-ai-skills

AI prompt skill engine for [OpenPencil](https://github.com/nicepkg/openpencil) — phase-driven prompt loading with design memory and intent matching.

## Install

```bash
npm install @zseven-w/pen-ai-skills
```

## Features

- **Phase-based loading** — `planning`, `generation`, `validation`, `maintenance` phases load different skill sets
- **Intent matching** — domain skills (landing page, dashboard, form, etc.) activate on keyword detection
- **Token budget** — per-phase budget prevents context overflow
- **Markdown skills** — prompts authored as `.md` files with YAML frontmatter
- **Vite plugin** — auto-compiles skill registry on save during development

## Usage

```typescript
import { resolveSkills } from '@zseven-w/pen-ai-skills';

const ctx = resolveSkills('generation', 'design a login page', {
  flags: { hasDesignMd: true },
});

for (const skill of ctx.skills) {
  console.log(skill.name, skill.content);
}
```

## Adding Skills

Create a `.md` file in `skills/` with frontmatter:

```markdown
---
name: my-skill
phase: generation
trigger: /\b(keyword)\b/i
priority: 10
budget: 2000
category: domain
---

Your prompt content here.
```

## License

MIT
