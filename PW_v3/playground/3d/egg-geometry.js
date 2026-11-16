import * as THREE from './three.module.min.js';

// The placeholder body, revolved from the same silhouette blob.py uses to
// render the 2D sprites -- so the proportions match the real model and
// swapping egg.glb in later does not change how anything is framed.
//
// blob.py's canonical space: origin at the top of the head, +y toward the
// feet, body 84 wide x 96 tall. Lathe wants XY points revolved around Y, so
// x is halved off the centre line and y is flipped and normalised to 0..1.
const H = 90;                       // canonical height used for normalising
const toLathe = (x, y) => new THREE.Vector2(x / H, (H - y) / H);

function cubic(p0, p1, p2, p3, steps) {
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

/** Right-hand profile, top of head down to the bottom of the body. */
export function eggProfile(steps = 14) {
  const pts = [[0, 0]];
  // crown: blob.py's dome(), the right half -- cubicTo(24,0, 43,10, 42,50)
  pts.push(...cubic([0, 0], [24, 0], [43, 10], [42, 50], steps));
  pts.push([41, 70]);
  // underside: cubicTo(41,86, 26,90, 0,90)
  pts.push(...cubic([41, 70], [41, 86], [26, 90], [0, 90], steps));
  return pts.map(([x, y]) => toLathe(x, y));
}

/**
 * Lathe gives us UVs for free: u runs around the body, v along the profile.
 * That is the layout the paint texture is written in, and it is close enough
 * to the real egg's unwrap that brush behaviour will carry over.
 */
export function makeEggGeometry(segments = 48) {
  const g = new THREE.LatheGeometry(eggProfile(), segments);
  g.computeVertexNormals();
  g.center();
  return g;
}
