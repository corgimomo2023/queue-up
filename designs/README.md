# NextQ design sources

This directory contains editable pen.dev design sources and rendered previews.

## Files

- `nextq-flow.pen` — editable pen.dev document using the public `.pen` v2.14 JSON schema
- `nextq-flow-preview.png` — rendered overview for review without pen.dev

The design covers two product surfaces:

1. Desktop Staff Admin dashboard
2. Mobile customer queue status

It follows the production frontend tokens in `apps/frontend/src/styles.css`, including the orange, cream, ink, muted, border and card colours. Product copy uses Hong Kong Traditional Chinese.

## Open and edit

Open `nextq-flow.pen` with the pen.dev desktop app or VS Code/Cursor extension.

For headless use, install and authenticate the official CLI:

```bash
npm install -g @pen.dev/cli
pen login
```

Render the checked-in preview:

```bash
pen --in designs/nextq-flow.pen \
  --export designs/nextq-flow-preview.png \
  --export-scale 1
```

The CLI currently requires a pen.dev account even for local export. Authentication is stored outside the repository under `~/.pencil/`; no credentials belong in source control.

## Design-source policy

- Keep `.pen` and preview changes in the same commit.
- Re-export after every visual change.
- Review the rendered PNG for clipping, overlap and overflow before committing.
- Keep customer-facing copy aligned with `apps/frontend/src/i18n/zh-HK.ts`.
