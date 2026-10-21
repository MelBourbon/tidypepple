# TidyPepple Style Guide

Design rules for the TidyPepple PWA, derived from Vercel's design system **Geist**
(<https://vercel.com/geist/introduction>). The colors are TidyPepple's own – warm paper gray
and teal – just organized in Geist's scale logic. The goal: a calm GTD app you keep open for
hours every day without it asking for attention.

All values live in `src/ui/tokens.css`. The app is built with Tailwind v4; the tokens appear
there as utilities (`bg-surface`, `text-muted`, `rounded-card`, `shadow-menu`,
`text-heading-20`, …). **Components use only these tokens.** Tailwind's default palette is
switched off (`--color-*: initial`) – `bg-white` or `text-gray-500` simply produce no CSS.

---

## 1. Principles

1. **Contrast before color.** The interface is warm gray on paper. Teal marks what currently
   applies (active view, selected filter, primary action), red what is urgent (overdue,
   important, delete). Color is information, not decoration.
2. **Flat and precise.** Hairlines instead of shadows, no gradients. Shadows only for things
   floating above the page (dialog, menus, toasts, FAB) – and for board cards, which you can
   grab and drag.
3. **One primary action per area.** The filled teal button is rare (“Capture”, “Sign in”).
   Everything else is secondary or tertiary.
4. **Calm typography.** Geist Sans, tight tracking only for headings, tabular numbers.
   Weight at most 600.
5. **Thumb-friendly.** Touch targets of 44 px on phones; otherwise the Geist heights of
   32 / 40 px.
6. **Light and dark.** Every color comes from a scale defined in both modes; the app follows
   `prefers-color-scheme`.

---

## 2. Colors

### Steps

Geist arranges every color in a scale with steps **100–1000**. The step says *what* the
color is used for – not how light it is:

| Step | Use |
|---|---|
| 100 | Component background |
| 200 | Hover background |
| 300 | Active / pressed background |
| 400 | Border |
| 500 | Hover border |
| 600 | Active border |
| 700 | High-contrast background (solid) |
| 800 | High-contrast background hover |
| 900 | Secondary text / icons |
| 1000 | Primary text / icons |

Plus two page backgrounds: `--ds-background-100` (surfaces: cards, lists, dialogs) and
`--ds-background-200` (page).

### Scales

Origin: the app's previous colors are set as anchor points (bold); the remaining steps are
interpolated in between.

| Token | Light | Dark |
|---|---|---|
| `--ds-background-100` | **`#ffffff`** | **`#1c1c1b`** |
| `--ds-background-200` | **`#faf9f7`** | **`#131313`** |
| `--ds-gray-100` | **`#f2f0ec`** | **`#262624`** |
| `--ds-gray-200` | `#ebe8e3` | `#2b2a28` |
| `--ds-gray-300` | `#e5e1da` | `#31302d` |
| `--ds-gray-400` | **`#e5e1da`** | **`#34332f`** |
| `--ds-gray-500` | `#cfc9bf` | `#4a4843` |
| `--ds-gray-600` | `#b3ada3` | `#67645e` |
| `--ds-gray-700` | `#8f8b84` | `#85827b` |
| `--ds-gray-800` | `#7c7973` | `#93908a` |
| `--ds-gray-900` | **`#6c6963`** | **`#a09d96`** |
| `--ds-gray-1000` | **`#1b1a18`** | **`#f3f1ed`** |
| `--ds-teal-100 / 200 / 400` | `#ebf7f4` / **`#d7efea`** / `#a3d8cd` | `#0f2421` / **`#143b36`** / `#1f5850` |
| `--ds-teal-700 / 800` | **`#0f766e`** / `#0b615a` | **`#5eead4`** / `#99f6e4` |
| `--ds-teal-900 / 1000` | `#0f766e` / `#08403b` | `#5eead4` / `#ccfbf1` |
| `--ds-teal-contrast` | **`#ffffff`** | **`#0a3b35`** |
| `--ds-red-100 / 200 / 400` | `#fdf0ee` / **`#fbe6e3`** / `#f0c4bd` | `#2a1715` / **`#3a1e1b`** / `#5e2c26` |
| `--ds-red-700 / 900` | `#b8342a` / **`#a8271d`** | `#ff8a80` / **`#ff8a80`** |
| `--ds-amber-100 / 200 / 400` | `#fff6e5` / `#fdefd2` / `#f2d59b` | `#261a07` / `#33230a` / `#59400f` |
| `--ds-amber-700 / 900` | `#e09b17` / `#8a5100` | `#f5b440` / `#f5b440` |

Deliberate deviations from Geist:
- **Teal instead of blue** as the accent (TidyPepple brand color). Teal 700 and 900 are the
  same: `#0f766e` reaches 5.5 : 1 on white and 4.5 : 1 on `accent-soft`, so it also works as
  text.
- **Warm gray instead of neutral.** The grays have the slight yellow tint of the original
  paper background.
- **Focus in teal**, not Geist's blue – one accent color is enough.

### Semantic tokens (Tailwind colors)

Components use these names, never the scales directly:

| Utility name | Points to | Used for |
|---|---|---|
| `canvas` | background-200 | Page background, sticky header |
| `surface` | background-100 | Cards, lists, dialogs, input fields |
| `raised` | gray-100 | Badges, ghost hover, board columns, progress bar track |
| `raised-hover` | gray-200 | Hover on `raised` |
| `line` | gray-400 | All hairlines and borders |
| `line-strong` | gray-500 | Hover border of fields and chips |
| `ink` | gray-1000 | Primary text |
| `muted` | gray-900 | Secondary text, icons, inactive navigation |
| `subtle` | gray-700 | Placeholders, “local” dot, disabled elements |
| `accent` | teal-700 | Primary button, active navigation, links, done check, focus |
| `accent-hover` | teal-800 | Primary button hover |
| `accent-ink` | teal-contrast | Text on `accent` |
| `accent-soft` | teal-200 | Background of active elements (nav, filter, project badge) |
| `accent-line` | teal-400 | Border of active chips |
| `danger` | red-900 | Delete, overdue, important, errors |
| `danger-soft` | red-200 | Background for “overdue”, error notices, “Delete” hover |
| `danger-line` | red-400 | Border of “Important only”, mandatory update |
| `warn` / `warn-soft` | amber-900 / amber-200 | Warnings that aren't errors |
| `warn-dot` | amber-700 | Sync dot “offline” / “read only” |
| `overlay` | – | Dimming behind dialogs (30 % light, 60 % dark) |

Status colors of the sync dot: gray (`subtle`) = no sync, teal = in sync or pending,
amber = offline/read only (nothing broken, just paused), red = locked (action needed).

---

## 3. Typography

**Fonts:** Geist Sans (`font-sans`) for everything, Geist Mono (`font-mono`) for the recovery
key. Both self-hosted (`@fontsource-variable/geist*`, Latin subset only, `src/ui/fonts.css`)
and precached by the service worker – the app looks the same offline.

**Numbers:** wherever numbers change or are stacked (counters, dates, progress, file sizes),
always use `tabular-nums`.

**User text size:** all sizes are in rem. The “Text size” setting scales the root –
typography and spacing grow together. Radii and shadows are in px and stay the same.

### Scale

Named as in Geist: `<role>-<pixel size>`. Heading = headings, Label = single line, Copy =
multi-line. Labels and copy are the Tailwind sizes that already match Geist's values;
headings are custom utilities with built-in tracking and weight.

| Role | Class | Size / line | Tracking | Weight | Use |
|---|---|---|---|---|---|
| Heading 24 | `text-heading-24` | 24 / 32 | −0.04em | 600 | Page title (`PageHeader`) |
| Heading 20 | `text-heading-20` | 20 / 26 | −0.02em | 600 | Task title in the detail view (there with `leading-7`, so the first line is centered on the 44 px done button) |
| Heading 16 | `text-heading-16` | 16 / 24 | −0.02em | 600 | Project title in the project list |
| Heading 14 | `text-heading-14` | 14 / 20 | −0.01em | 600 | App name, card title, empty state, sections in sync |
| Label 18 | `text-lg` | 18 / 28 | 0 | 400 | “Quick capture” input field |
| Label 14 | `text-sm` | 14 / 20 | 0 | 400/500 | Task title in list and board, buttons, fields, navigation, menus |
| Label 12 | `text-xs` | 12 / 16 | 0 | 400/500 | Badges, chips, meta, tab bar |
| Overline | `text-overline` | 12 / 16 | +0.04em | 500 | Section headings (uppercase, `muted`) |
| Copy 14 | `text-sm` | 14 / 20 | 0 | 400 | Hints, help texts, notes |

Rules:
- No weight above 600 (`font-semibold`); no `font-bold`.
- Uppercase only as `text-overline`.
- Secondary information becomes **gray** (`text-muted`) – not additionally smaller *and*
  thinner.

---

## 4. Materials (radii, borders, shadows)

| Material | Radius | Border | Shadow | Use |
|---|---|---|---|---|
| Base | `rounded-md` (6 px) | `line` | – | Buttons, fields, selects, menu items, attachment tiles |
| Small | `rounded-card` (12 px) | `line` | `shadow-small` | Board cards (draggable), project cards |
| Medium | `rounded-card` (12 px) | `line` | – | List groups, notice cards, board columns |
| Menu | `rounded-card` (12 px) | `line` | `shadow-menu` | Filter/picker menus, toasts, update notices |
| Modal | `rounded-card` (12 px) | `line` | `shadow-modal` | “Quick capture” |
| Pill | `rounded-full` | – / `line` | – | Badges, chips, filter chips, checkbox circles, FAB |

Shadows (light; in dark mode only downward and stronger, because the border draws the edge
there):

```css
--shadow-small: 0 2px 2px rgb(27 26 24 / .04);
--shadow-menu:  0 1px 1px rgb(27 26 24 / .02), 0 4px 8px -4px rgb(27 26 24 / .06), 0 16px 24px -8px rgb(27 26 24 / .08);
--shadow-modal: 0 1px 1px rgb(27 26 24 / .02), 0 8px 16px -4px rgb(27 26 24 / .06), 0 24px 32px -8px rgb(27 26 24 / .1);
```

Floating elements **always** have a border as well.

---

## 5. Spacing & layout

- **4 px grid** (Tailwind spacing is 0.25 rem): 4, 8, 12, 16, 24, 32 …
- Page margin 16 px (`px-4`). Lists at most 896 px wide (`max-w-4xl`), centered in the space
  next to the sidebar; only the board uses the full width.
- From 768 px on, a sidebar (208 px) instead of the tab bar, always at the left edge.
- List rows run edge to edge with a hairline in between; cards (board, projects) sit 8 px
  apart.
- 8 px between section heading and content, 4 px between label and field.

---

## 6. Components

### Buttons

| Variant | Look | Examples |
|---|---|---|
| Primary | `bg-accent text-accent-ink`, hover `bg-accent-hover`, no border | “Capture”, “Quick capture”, “Sign in” |
| Secondary | `bg-surface border-line`, hover `bg-raised` | Export/import, “+ Attach”, sort direction |
| Tertiary | no border, `text-muted`, hover `bg-raised text-ink` | “Cancel”, “Close”, “Important”, icon buttons |
| Error | `text-danger`, hover `bg-danger-soft` | “Delete”, “Delete all” |
| Link | `text-accent`, underlined on hover | “Back up my data”, “Undo” |

Heights: small 32 px (`h-8`), medium 40 px (`h-10`), touch 44 px (`min-h-11`). Radius 6 px.
Text Label 14 (small: Label 12), weight 500 for primary. Disabled: `opacity-40`,
`cursor-not-allowed`. No scaling on press; transitions via `transition-colors`.

**FAB** (mobile): 56 px round, primary colors, `shadow-menu` – the only floating primary
action.

### Input fields

Height 40 px (`h-10`), `rounded-md`, `bg-surface`, border `line`. Hover:
`border-line-strong`. Focus: `border-accent` (for fields with `outline-none`, the border
replaces the base layer's focus ring). Placeholder: `text-subtle`. Labels: `text-overline`
above.

Exception: fields *inside* a list (“Add step”, renaming a context) are borderless and
transparent – the list is their frame.

### Focus

`:focus-visible` → `outline: 2px solid accent`, 2 px offset. Never remove focus without a
replacement.

### Lists & cards

- **Task row** (list): borderless, `bg-surface`, hairline below.
- **Task card** (board): small material.
- **Groups** (steps, contexts, files): medium material with hairlines between rows.
- **Board column**: medium material on `raised/50`; while dragging over it,
  `border-accent-line bg-accent-soft/40`.
- **Done circle**: 20 px, border `line` (hover `accent`), when done filled with `accent` and
  a check in `accent-ink`.

### Badges & chips

Label 12, pill. Badges are flat (no border), chips have a border.

| Variant | Background / text | Use |
|---|---|---|
| Gray | `raised` / `muted` | Due date, waiting, project reference |
| Teal | `accent-soft` / `accent` | Project badge, follow-up due |
| Red | `danger-soft` / `danger` | Overdue |
| Chip | `surface` + `line` / `muted`, hover `line-strong` | Context, filter, picker |
| Active chip | `accent-soft` + `accent-line` / `accent` | Selected filter/context |

### Navigation

- **Tab bar** (mobile): `bg-surface/95` + `backdrop-blur`, hairline on top, icon 20 px +
  Label 12; active `text-accent`.
- **Sidebar** (desktop): items 36 px tall, `rounded-md`; active
  `bg-accent-soft text-accent font-medium`, hover `bg-raised`.

### “Quick capture” dialog

Modal material, at most 512 px, at the top of the viewport (room for the keyboard), overlay
`bg-overlay`. Footer with a hairline, tertiary + primary (small).

### Toasts & notices

Menu material, `bg-surface`, text Label 14, action as a link button. Mandatory update:
border `danger-line`, text `danger`.

---

## 7. Icons

Stroke width 1.4–2, sizes 12 / 14 / 16 / 20 px; Lucide shapes (ISC) or custom 16 px paths.
Color inherits from the text; decorative icons `text-muted`.

## 8. Motion

Transitions of 150 ms (`transition-colors`) for color and border. No bouncing or scaling
animations. `prefers-reduced-motion` turns transitions off.

## 9. Accessibility

- Text contrast at least 4.5 : 1: `muted` on `surface`/`canvas` and `accent` on
  `surface`/`accent-soft` meet this in both modes.
- Touch targets at least 44 × 44 px on phones (checkbox, tab bar, delete) – visibly smaller
  elements get a larger hit area.
- Never color alone: “Important” carries a flag, “overdue” the word.

## 10. Do / Don't

| Do | Don't |
|---|---|
| `text-muted` | `text-gray-500`, `text-[#6c6963]` |
| One primary per area | Several teal buttons side by side |
| `border border-line` | Shadows on lists and notice cards |
| `rounded-md` / `rounded-card` / `rounded-full` | `rounded-lg`, `rounded-2xl`, `rounded-[10px]` |
| Buttons `rounded-md` | Buttons as pills (pills are chips and badges) |
| `font-medium` / `font-semibold` | `font-bold` |
| `text-overline` | `text-xs uppercase font-medium text-muted` by hand |
| `shadow-menu` for floating elements | `shadow-lg`, `shadow-xl` |
| Numbers `tabular-nums` | Jumping counters |
