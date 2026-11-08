// A subtle Lego-plate texture for paving: square tiles, each a slightly different shade, with fine grout lines
// and a soft round stud lit from the top left. One tile is 1 m, and the canvas holds 4 × 4 of them.
import * as THREE from 'three';

const canvases = new Map<string, HTMLCanvasElement>();

function plate(base: string): HTMLCanvasElement {
  let canvas = canvases.get(base);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d')!;
  const color = new THREE.Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  // Seeded, so the pattern is the same every load.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const shade = (dl: number) => `hsl(${hsl.h * 360}, ${hsl.s * 100}%, ${Math.max(0, Math.min(100, (hsl.l + dl) * 100))}%)`;
  const size = 64;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const px = x * size;
      const py = y * size;
      g.fillStyle = shade((rand() - 0.5) * 0.05);
      g.fillRect(px, py, size, size);
      // The stud: a soft shadow down-right, a lighter top, and a highlight on its upper-left rim.
      const cx = px + size / 2;
      const cy = py + size / 2;
      g.fillStyle = shade(-0.045);
      g.beginPath();
      g.arc(cx + 2, cy + 2.5, 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = shade(0.025);
      g.beginPath();
      g.arc(cx, cy, 15, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = shade(0.07);
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(cx, cy, 13.5, Math.PI * 0.95, Math.PI * 1.6);
      g.stroke();
    }
  }
  // Grout between tiles.
  g.fillStyle = shade(-0.09);
  for (let i = 0; i <= 4; i++) {
    g.fillRect(i * size - 1, 0, 2, 256);
    g.fillRect(0, i * size - 1, 256, 2);
  }
  canvases.set(base, canvas);
  return canvas;
}

/** A tile texture in `base` colour, repeated to cover `width` × `depth` metres at 1 m a tile. */
export function tileTexture(base: string, width: number, depth: number): THREE.Texture {
  const tex = new THREE.CanvasTexture(plate(base));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(width / 4, depth / 4);
  tex.anisotropy = 4;
  return tex;
}
