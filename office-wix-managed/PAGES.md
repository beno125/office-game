# Game pages structure

Multi-level layout: **one route per world**, each page loads only its scene chunk.

## Routes (Wix / Astro)

| URL | Page | What loads |
|-----|------|------------|
| `/` | `src/pages/index.astro` | `GamePage` — intro → loader → play (single page, no navigation) |
| `/office` | `src/pages/office/index.astro` | `OfficeScene` only (skip intro + loader; dev / deep link) |
| `/kitchen` | `src/pages/kitchen/index.astro` | `KitchenScene` stub (future `kitchenSceneModule.js`) |

Root Vite app mirrors the same paths in `src/App.jsx` (`/`, `/office`, `/kitchen`).

## Folders

```
src/
  pages/                    # Astro file routes (Wix deploy)
  components/
    game/                   # Thin shell — no Three.js
      GamePage.jsx          # Intro → loader → play (single page)
      IntroPage.jsx         # Start play UI (used by GamePage)
      GameLoader.jsx        # Legacy split loader (unused; kept for reference)
      KitchenScene.jsx      # Kitchen placeholder
      officeSceneEvents.js  # Scene → UI events (CustomEvent)
      sceneRoutes.js        # Path constants
    OfficeScene.jsx         # Mount + dynamic import for table world
    office/
      officeSceneModule.js  # Generated from office-scene.html (do not hand-edit)
      officeSceneMount.js
```

Kitchen will follow the same pattern later:

```
components/
  KitchenScene.jsx          # dynamic import("./kitchen/kitchenSceneModule.js")
  kitchen/
    kitchenSceneModule.js   # from separate kitchen doc
```

## Loader behaviour

1. **`/`** shows `GamePage` — intro with **Start play** (no 3D download until clicked).
2. **Start play** mounts the table scene on the same page (no URL change).
3. **Loader overlay:** “Loading office world…” then “Filling the gums tank…”.
4. Overlay fades when gums settle; player stays on `/`.

The scene emits `office-scene:gums-tank-initial-settled` once.

## Future: table → kitchen

- **Table scene doc:** car jumps into `drawer` group → emit e.g. `drawer-transition-complete`.
- **Shell:** `onOfficeSceneEvent(...)` → `window.location.href = SCENE_ROUTES.kitchen` (or Astro client navigate).
- **Kitchen page:** loads same car GLTF (`car-game13.gltf`), new room GLTF, smaller bundle.

## Scene updates

The scene modules are edited directly in `src/` (and mirrored to `office-wix-managed/src/components/`); they're no longer generated from `office-scene.html`.

## Performance notes

- Each world = separate `import()` chunk; kitchen visitors never download office module.
- Keep `game/` components free of `three` / `cannon-es` imports.
- Shared car assets stay in `public/office-scene-optimized/` (or a shared `public/car/` later).
