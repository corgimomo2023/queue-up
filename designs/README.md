# Easy Queue design sources

This directory contains editable pen.dev design sources and rendered previews.

## Files

| Source                       | Preview                              | Artboards                                              |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------ |
| `easy-queue-flow.pen`        | `easy-queue-flow-preview.png`        | Desktop Staff dashboard; mobile customer queue         |
| `easy-queue-landing.pen`     | `easy-queue-landing-preview.png`     | Desktop and mobile landing/staff sign-in               |
| `easy-queue-super-admin.pen` | `easy-queue-super-admin-preview.png` | Event Admin overview, events, audit and system modules |

All `.pen` files use the public v2.14 JSON schema. They follow the production frontend tokens in `apps/frontend/src/styles.css`, including the orange, cream, ink, muted, border and card colours. Product copy uses Hong Kong Traditional Chinese and represents supported Easy Queue workflows.

## Open and edit

Open a `.pen` file with the pen.dev desktop app or VS Code/Cursor extension.

For headless use, install and authenticate the official CLI:

```bash
npm install -g @pen.dev/cli
pen login
```

Render the checked-in previews:

```bash
pen --in designs/easy-queue-flow.pen \
  --export designs/easy-queue-flow-preview.png \
  --export-scale 1

pen --in designs/easy-queue-landing.pen \
  --export designs/easy-queue-landing-preview.png \
  --export-scale 1

pen --in designs/easy-queue-super-admin.pen \
  --export designs/easy-queue-super-admin-preview.png \
  --export-scale 1
```

The CLI currently requires a pen.dev account even for local export. Authentication is stored outside the repository under `~/.pencil/`; no credentials belong in source control.

At pen CLI 0.3.0, a failed export may still exit with status 0. Verification must therefore require all three conditions: the output file exists and is non-empty, CLI output contains `Export saved to:`, and CLI output does not contain `Failed to export`.

## Design-source policy

- Keep `.pen` and preview changes in the same commit.
- Re-export after every visual change.
- Review the rendered PNG pixels for clipping, overlap and overflow before committing.
- Keep customer-facing copy aligned with `apps/frontend/src/i18n/zh-HK.ts`.
- Keep examples generic; do not include production domains, credentials or private infrastructure.
