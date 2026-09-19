# Colour It

Turn any photo, drawing, or artwork (upload a file or paste an image link) into a
black-and-white colouring page, previewed and printable at A4 size.

Built for turning Pokémon artwork and similar flat-shaded images into clean,
printable outlines, but works with regular photos too.

## How it works

- Upload an image file, or paste a direct image URL (fetched server-side via
  `/api/fetch-image`, with basic SSRF protections, so it works around CORS).
- The image is converted to grayscale, lightly blurred, posterized to flatten
  shading into bands, then run through Sobel edge detection and thresholded
  into a black-and-white line drawing — entirely in the browser via Canvas.
- A "Line detail" slider re-thresholds the precomputed edge map instantly.
- "Print page" opens the browser print dialog with a stylesheet that shows
  only the line-art page, sized for A4.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript checks

## Stack

Next.js (App Router), TypeScript, Tailwind CSS. Deployed on Vercel.
