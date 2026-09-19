// Converts a photo into black-and-white line art suitable for colouring,
// using grayscale -> blur -> Sobel edge detection -> threshold.

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
  edges: Float32Array;
}

function toGrayscale(data: Uint8ClampedArray): Float32Array {
  const gray = new Float32Array(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

function boxBlur3x3(src: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          sum += src[ny * width + nx];
          count++;
        }
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

function sobelMagnitude(gray: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(gray.length);
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
      out[y * width + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
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

/** Expensive step: run once per source image. */
export function computeEdgeMap(source: ImageData): EdgeMap {
  const { width, height, data } = source;
  const gray = toGrayscale(data);
  const blurred = boxBlur3x3(gray, width, height);
  const posterized = posterize(blurred, POSTERIZE_LEVELS);
  const edges = sobelMagnitude(posterized, width, height);
  return { width, height, edges };
}

/** Cheap step: safe to call on every slider tick. sensitivity is 0-100. */
export function thresholdEdgeMap(map: EdgeMap, sensitivity: number): ImageData {
  const { width, height, edges } = map;
  // Gradient magnitude is skewed toward low values with a few strong outliers
  // (e.g. whisker highlights), so a steep curve puts the useful "outline
  // visible, not too noisy" zone around the middle of the slider.
  const t = 1 - sensitivity / 100;
  const threshold = 200 * t * t * t + 8;

  const mask = new Uint8Array(edges.length);
  for (let p = 0; p < edges.length; p++) {
    mask[p] = edges[p] > threshold ? 1 : 0;
  }

  // Dilate by 1px so thin or slightly broken edges read as solid,
  // continuous strokes instead of dashed/dotted lines.
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
