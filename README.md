# Astronomy 3D site

**Live: https://nisith-akain.github.io/Astronomy/ 

Scroll-driven 3D astronomy page: spiral galaxy hero, a real-orbit solar
system, a probe fly-by and an outro. Vite + TypeScript (strict) + three.js.
Static hosting only; no backend. Deploys automatically to GitHub Pages on
every push to `main` (see `.github/workflows/deploy.yml`).

Built by [Nisith Akain](https://github.com/Nisith-Akain) —
h.a.dnisith@gmail.com. Need a site designed? Get in touch.

## Requirements

- Node.js 20.19+ (tested on Node 24) and npm 10+
- A current evergreen browser (Chrome, Firefox, Safari, Edge) with WebGL2

## Run

```sh
npm install        # or: npm ci
npm run dev        # dev server with HMR (http://localhost:5173)
npm run typecheck  # tsc --noEmit (strict)
npm test           # vitest run
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ locally
npm run build:onefile  # builds a single self-contained main.html
                        # (open directly via file://, no server needed)
```

`vite.config.ts` uses `base: './'`, so the contents of `dist/` can be
uploaded to any static host or subdirectory as-is.

## Layout

See `TEAM/INTERFACES.md` (contract C1). Runtime data and assets live in
`public/` (`data/planets.json`, `textures/`, `models/`); source in `src/`;
unit tests in `tests/`. Blender sources live in `assets-src/` and are not
shipped.
