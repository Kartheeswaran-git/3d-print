# Luna Litho Studio — architecture

Luna Litho Studio turns photos into printable lithophane moon lamps and designs
two-colour name keychains. Everything runs in the browser: images never leave the
device, meshes are built in a Web Worker, and files are downloaded locally.

## Stack

- Next.js 16 (App Router, Turbopack) · React 19 · TypeScript (strict)
- Tailwind CSS v4 with the house design-system tokens in `src/app/globals.css`
- three.js via `@react-three/fiber` + `@react-three/drei` for the 3D preview
- zustand for studio state · Radix primitives (`radix-ui`) for accessible controls
- Vitest for the pure geometry / image / export modules

## Routes

| Route        | What it is                                             |
| ------------ | ------------------------------------------------------ |
| `/`          | Home: pick a tool                                      |
| `/moon-lamp` | Lithophane studio (sphere lamp + flat shapes)          |
| `/keychain`  | Name keychain studio                                   |

Studio pages are client components; the 3D viewer is loaded with
`next/dynamic(..., { ssr: false })` because WebGL cannot render on the server.

## Source layout

```
src/
  app/                    routes, root layout, globals.css (tokens + textures)
  components/
    ui/                   design-system primitives (button, fields, section, toast…)
    shell/                app chrome: top bar, navigation, theme toggle
    viewer/               ModelViewer (R3F canvas, lighting, backlight material, camera presets,
                          "place" mode with BVH picking for Move photo)
    studio/               layout pieces shared by both studios (stage, metrics, export card)
  features/
    lithophane/           settings.ts (schema) · store.ts (+ undo history) · presets.ts · place-drag.ts ·
                          preview/export hooks · editor/ (layout editor maths) · components/
    keychain/             settings.ts (schema) · store.ts · fonts.ts · rasterize.ts · hooks · components/
  lib/
    geometry/             pure mesh builders + manifold check (no DOM, runs in worker and tests)
    export/               STL (binary/ASCII) and AMF writers (pure)
    image/                photo/mask/moon-map loading, projection (project.ts, pure), tone pipeline
    state/                attachHistory (undo/redo for any settings store) · shared Simple/Advanced mode
    worker/               protocol.ts · mesh.worker.ts · client.ts · use-mesh-worker.ts
    utils/                cn, clamp/snap, formatting, safe file names, downloads
```

Rules of thumb:

- `lib/geometry` and `lib/export` are pure TypeScript with no DOM access, so
  they run in the worker and in Vitest.
- **Preview and export use the same mesh builders.** The preview is just a
  lower-resolution run of the export pipeline, so what you see is what you print.
- Every setting's range, default and display format lives in the feature's
  `settings.ts`. Controls, reset, sanitising and project load all read from there.

## Data flow

```
Lithophane
  photo File ──loadPhoto──▶ SourceImage (EXIF-corrected, downscaled ≤ 2400 px)
  moon map ──loadMoonMap(surface, "preview" 2K | "export" 4K)──▶ GrayMap
  settings ──▶ makeSampler(domain…) ──renderGrid──▶ composeLuminance ──▶ LuminanceField (+ thumbnails)
          ──▶ MeshWorkerClient.preview(FlatJob | SphereJob)   ─▶ ModelViewer
          ──▶ MeshWorkerClient.export(job, "stl-binary")     ─▶ download

Keychain
  settings ──ensureFont──▶ rasterizeKeychain(dpmm) ──▶ baseAlpha + textAlpha
          ──▶ MeshWorkerClient.preview(KeychainJob)  ─▶ ModelViewer (base + text parts)
          ──▶ MeshWorkerClient.export(job, "amf" | "stl-*") ─▶ download
```

### Worker protocol (`lib/worker/protocol.ts`)

Requests carry an `id`. Previews coalesce: at most one preview is in flight plus
the latest pending one; superseded previews resolve to `null`. Exports queue
behind the in-flight preview and never get confused with previews. If the worker
crashes, every pending request rejects with a readable error and the next request
starts a fresh worker.

### Projection (`lib/image/project.ts`)

The composition is sampled exactly at the mesh grid points (`renderGrid`), so the mesh, the
height map and the layout editor all read the same sampler.

- Sphere: column c of C sits at θ = 360°·(c/C − ½) — column C/2 faces the camera (+Z), θ grows
  towards +X and the seam is at the back. The geometry, `renderGrid`, the layout editor's front
  view (`frontViewToLamp`) and the 3D Move photo hit mapping (θ = atan2(x, z), φ = asin(y/|p|))
  all use this convention. The moon wraps 1:1 (lon = θ + moonLongitude); the photo is an
  orthographic decal centred at λ0 = imageX·1.8°, φ0 = −imageY·0.9°. The model crop aspect is 1:1.
- Flat pieces: centred on the origin, +y up, row 0 at the top. imageX / imageY are percent of
  W / H; the moon is an orthographic disc.

### Undo

`attachHistory(store)` snapshots `settings` on every change. Edits within 500 ms merge; slider
drags, layout-editor gestures and 3D Move photo drags are wrapped in `begin()` / `end()`; reset,
load, presets and starter designs are single steps. The lamp's history ignores view preferences
(wireframe, backlight, format). History clears once the autosave has loaded.

### Geometry

- Flat pieces are closed height-field solids: top relief, flat back, and side walls
  wherever a solid cell meets an empty one. Cells that touch only at a corner are
  resolved before meshing so every edge is shared by exactly two triangles.
- Spheres are hollow shells: outer relief surface, smooth inner surface, a closed top
  pole and an annular rim at the bottom opening.
- `checkManifold` counts boundary, non-manifold and degenerate edges. Exports report
  "Watertight" only when that check passes.

## Scripts

```
npm run dev        # start the dev server
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # vitest
```
