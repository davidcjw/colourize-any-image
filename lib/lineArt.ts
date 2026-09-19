// Converts a photo into black-and-white line art suitable for colouring,
// using grayscale -> posterize -> Sobel -> non-max suppression -> threshold
// -> speckle cleanup -> dilate.

export const MAX_DIMENSION = 1800;

export function computeTargetSize(width: number, height: number) {
  if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
    return { width, height };
  }
  const scale = MAX_DIMENSION / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface EdgeMap {
  width: number;
  height: number;
  /** Gradient magnitude, already thinned to single-pixel ridges. */
  ridges: Float32Array;
}

function toGrayscale(data: Uint8ClampedArray): Float32Array {
  const gray = new Float32Array(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

const POSTERIZE_LEVELS = 6;

/** Flattens smooth shading/gradients into bands so edge detection only
 * fires on real shape boundaries, not soft shading within a surface. */
function posterize(gray: Float32Array, levels: number): Float32Array {
  const step = 255 / (levels - 1);
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    out[i] = Math.round(gray[i] / step) * step;
  }
  return out;
}

interface SobelResult {
  magnitude: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
}

function sobel(gray: Float32Array, width: number, height: number): SobelResult {
  const magnitude = new Float32Array(gray.length);
  const gxOut = new Float32Array(gray.length);
  const gyOut = new Float32Array(gray.length);
  const at = (x: number, y: number) => {
    const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
    const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
    return gray[cy * width + cx];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx =
        -at(x - 1, y - 1) + at(x + 1, y - 1) +
        -2 * at(x - 1, y) + 2 * at(x + 1, y) +
        -at(x - 1, y + 1) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const i = y * width + x;
      magnitude[i] = Math.sqrt(gx * gx + gy * gy);
      gxOut[i] = gx;
      gyOut[i] = gy;
    }
  }
  return { magnitude, gx: gxOut, gy: gyOut };
}

function bilinearSample(
  values: Float32Array,
  width: number,
  height: number,
  fx: number,
  fy: number
): number {
  if (fx < 0 || fx > width - 1 || fy < 0 || fy > height - 1) return 0;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const v00 = values[y0 * width + x0];
  const v10 = values[y0 * width + x1];
  const v01 = values[y1 * width + x0];
  const v11 = values[y1 * width + x1];
  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}

/** Thins wide gradient "ramps" (from blur/posterize band transitions) down
 * to a single-pixel ridge along the true edge, instead of keeping every
 * pixel across the ramp — this is what makes lines crisp instead of fat
 * and blobby. Samples neighbours by bilinear interpolation along the exact
 * gradient direction rather than snapping to 4 coarse compass directions,
 * which otherwise mis-suppresses real ridge points on smoothly curving
 * diagonal edges (visible as dashed lines on curved outlines). */
function nonMaxSuppress(
  { magnitude, gx, gy }: SobelResult,
  width: number,
  height: number
): Float32Array {
  const out = new Float32Array(magnitude.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const m = magnitude[i];
      if (m === 0) continue;
      const len = Math.hypot(gx[i], gy[i]);
      if (len === 0) continue;
      const ux = gx[i] / len;
      const uy = gy[i] / len;
      const forward = bilinearSample(magnitude, width, height, x + ux, y + uy);
      const backward = bilinearSample(magnitude, width, height, x - ux, y - uy);
      out[i] = m >= forward && m >= backward ? m : 0;
    }
  }
  return out;
}

/** Expensive step: run once per source image. */
export function computeEdgeMap(source: ImageData): EdgeMap {
  const { width, height, data } = source;
  const gray = toGrayscale(data);
  const posterized = posterize(gray, POSTERIZE_LEVELS);
  const sobelResult = sobel(posterized, width, height);
  const ridges = nonMaxSuppress(sobelResult, width, height);
  return { width, height, ridges };
}

const MIN_SPECKLE_SIZE = 8;

/** Removes small isolated blobs (e.g. from tiny highlight specks) that
 * survive thresholding but aren't part of any real outline. */
function removeSpeckles(
  mask: Uint8Array<ArrayBufferLike>,
  width: number,
  height: number
): Uint8Array<ArrayBufferLike> {
  const out = mask.slice();
  const visited = new Uint8Array(mask.length);
  const stack: number[] = [];
  const component: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;

    component.length = 0;
    stack.push(start);
    visited[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      component.push(p);
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const np = ny * width + nx;
          if (mask[np] && !visited[np]) {
            visited[np] = 1;
            stack.push(np);
          }
        }
      }
    }

    if (component.length < MIN_SPECKLE_SIZE) {
      for (const p of component) out[p] = 0;
    }
  }
  return out;
}

/** Cheap-ish step: safe to call on every slider tick. sensitivity is 0-100. */
export function thresholdEdgeMap(map: EdgeMap, sensitivity: number): ImageData {
  const { width, height, ridges } = map;
  // Gradient magnitude is skewed toward low values with a few strong outliers
  // (e.g. whisker highlights), so a steep curve puts the useful "outline
  // visible, not too noisy" zone around the middle of the slider.
  const t = 1 - sensitivity / 100;
  const threshold = 200 * t * t * t + 8;

  let mask: Uint8Array<ArrayBufferLike> = new Uint8Array(ridges.length);
  for (let p = 0; p < ridges.length; p++) {
    mask[p] = ridges[p] > threshold ? 1 : 0;
  }
  mask = removeSpeckles(mask, width, height);

  // Dilate by 1px so the now-thin, clean ridge lines read as a bold,
  // deliberate stroke instead of a hairline.
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let isEdge = false;
      for (let dy = -1; dy <= 1 && !isEdge; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (mask[ny * width + nx]) {
            isEdge = true;
            break;
          }
        }
      }
      const v = isEdge ? 0 : 255;
      const o = (y * width + x) * 4;
      out.data[o] = v;
      out.data[o + 1] = v;
      out.data[o + 2] = v;
      out.data[o + 3] = 255;
    }
  }
  return out;
}
