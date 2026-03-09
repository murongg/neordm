# NeoRDM Theme Colors

## Source of truth

- Runtime theme tokens live in `src/index.css`
- Theme switching is handled by `src/hooks/useTheme.ts`
- The active DaisyUI themes are `light` and `night`
- `src/App.css` is legacy Vite scaffold CSS and is not imported by `src/main.tsx`

## Core semantic palette

### Light

- `base-100`: `#f8fafc`
- `base-200`: `#f1f5f9`
- `base-300`: `#e2e8f0`
- `base-content`: `#0f172a`
- `primary`: `#16a34a`
- `secondary`: `#334155`
- `accent`: `#0f766e`
- `info`: `#0369a1`
- `success`: `#15803d`
- `warning`: `#b45309`
- `error`: `#dc2626`

### Dark

- `base-100`: `#0f172a`
- `base-200`: `#111827`
- `base-300`: `#1e293b`
- `base-content`: `#e2e8f0`
- `primary`: `#22c55e`
- `secondary`: `#334155`
- `accent`: `#14b8a6`
- `info`: `#38bdf8`
- `success`: `#4ade80`
- `warning`: `#f59e0b`
- `error`: `#f87171`

## Usage rules

- `primary`: brand accent, selected state, default emphasis, active controls
- `success`: positive result, saved state, healthy connection, completed action
- `warning`: confirmation, caution, pending risk
- `error`: destructive action, failure, invalid state
- `info`: helper information, neutral technical feedback
- `accent`: secondary highlight that should not compete with `primary`
- `base-*`: all surfaces, dividers, and main text contrast

## Extended NeoRDM tokens

These semantic extension tokens are also defined in `src/index.css` and should be preferred over ad-hoc colors for component details:

- `--neordm-panel-border`
- `--neordm-scrollbar-thumb`
- `--neordm-scrollbar-thumb-hover`
- `--neordm-editor-guide`
- `--neordm-editor-active-line`
- `--neordm-editor-active-gutter`
- `--neordm-editor-selection`
- `--neordm-syntax-key`
- `--neordm-syntax-string`
- `--neordm-syntax-number`
- `--neordm-syntax-null`

## Current cleanup direction

- Theme previews in settings now read from real theme variables instead of standalone hardcoded swatches
- JSON editor and JSON preview highlighting use shared `--neordm-*` tokens
- New UI states should prefer semantic theme classes or `--neordm-*` tokens instead of raw hex values
