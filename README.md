# Luna Litho Studio

Design 3D-printable objects from your own photos and names, right in the browser.

- **Moon lamp**: wrap a photo around a hollow moon globe, or make a flat crescent,
  circle, heart, rectangle or custom-shaped lithophane. Preview it with a simulated
  backlight, then download a watertight STL.
- **Name keychain**: type a name, pick a font and download a two-colour keychain as
  a multi-part AMF (Prusa, Bambu, Orca) or a single-part STL.

Everything is processed on your device. Photos are never uploaded, and meshes are
built in a Web Worker.

## Getting started

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Start the development server        |
| `npm run build`     | Create a production build           |
| `npm start`         | Serve the production build          |
| `npm run typecheck` | Type-check with `tsc --noEmit`      |
| `npm run lint`      | Lint with ESLint                    |
| `npm test`          | Run the Vitest unit tests           |

## Printing tips

| Moon lamp       |                               | Keychain         |                                   |
| --------------- | ----------------------------- | ---------------- | --------------------------------- |
| Material        | White PLA                     | Layer height     | 0.2 mm                            |
| Layer height    | 0.08–0.16 mm                  | Infill           | 20–30%                            |
| Infill          | 100%                          | Two colours      | Load the AMF as a multi-part object, or add a filament change at the base thickness |
| Orientation     | Sphere opening down; flat pieces upright |  |                                   |

## Project structure

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module layout, data flow,
worker protocol and geometry conventions.
