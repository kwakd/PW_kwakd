import * as THREE from './three.module.min.js';

// The placeholder character, built from the same numbers blob.py uses to
// render the 2D sprites: body silhouette, limb positions, face placement.
// So the proportions already match, and swapping egg.glb in later changes
// the meshes but not how anything is framed.
//
// blob.py's canonical space: origin at the top of the head, +y toward the
// feet, body 84 wide x 96 tall. Here everything is divided by H and y is
// flipped, so the character stands from y=0 up to y=1.
const H = 90;
export const INK = 0x14110f;
export const CREAM = '#f3ece0';

const cx = (x) => x / H;
const cy = (y) => (H - y) / H;

function cubic(p0, p1, p2, p3, steps) {
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push([
      u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
      u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1],
    ]);
  }
  return out;
}

/** Right-hand profile in canonical units, crown down to the underside. */
function profileCanonical(steps = 16) {
  const pts = [[0, 0]];
  pts.push(...cubic([0, 0], [24, 0], [43, 10], [42, 50], steps));   // dome()
  pts.push([41, 70]);
  pts.push(...cubic([41, 70], [41, 86], [26, 90], [0, 90], steps)); // underside
  return pts;
}

export function eggProfile() {
  return profileCanonical().map(([x, y]) => new THREE.Vector2(cx(x), cy(y)));
}

/** Body half-width at a canonical height, for seating the face on the surface. */
export function radiusAt(yCanon) {
  const p = profileCanonical();
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i];
    if ((y0 <= yCanon && yCanon <= y1) || (y1 <= yCanon && yCanon <= y0)) {
      const t = y1 === y0 ? 0 : (yCanon - y0) / (y1 - y0);
      return cx(x0 + (x1 - x0) * t);
    }
  }
  return cx(42);
}

export function makeBodyGeometry(segments = 56) {
  const g = new THREE.LatheGeometry(eggProfile(), segments);
  g.computeVertexNormals();
  return g;
}

/** A limb: a stretched blob from a to b, as in blob.py's capsule strokes. */
function limb(a, b, width) {
  const A = new THREE.Vector3(cx(a[0]), cy(a[1]), 0);
  const B = new THREE.Vector3(cx(b[0]), cy(b[1]), 0);
  const len = A.distanceTo(B);
  const r = cx(width) / 2;
  const g = new THREE.CapsuleGeometry(r, len, 6, 14);
  const m = new THREE.Mesh(g);
  m.position.copy(A).lerp(B, 0.5);
  // capsule runs along +Y; rotate it onto the a->b direction
  const dir = new THREE.Vector3().subVectors(B, A).normalize();
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return m;
}

/**
 * The whole character. `body` is the only paintable surface; the face, arms
 * and legs are their own meshes so a brush stroke cannot wipe the face off.
 */
export function makeEggCharacter(bodyMaterial) {
  const group = new THREE.Group();
  const solid = new THREE.MeshToonMaterial({ color: 0xece4d6 });
  const ink = new THREE.MeshBasicMaterial({ color: INK });

  const body = new THREE.Mesh(makeBodyGeometry(), bodyMaterial);
  body.name = 'body';
  group.add(body);

  // limbs, from blob.py's idle rig
  for (const [a, b, w] of [
    [[-34, 56], [-50, 66], 20],
    [[34, 56], [50, 66], 20],
    [[-15, 80], [-18, 96], 24],
    [[15, 80], [18, 96], 24],
  ]) {
    const m = limb(a, b, w);
    m.material = solid;
    group.add(m);
  }

  // face: eyes at (+/-9.68, 29) r 4.4, mouth bar at y 38 -- face_at() and
  // STYLE in blob.py. Seated just proud of the body surface at that height.
  const eyeR = cx(4.4);
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 16, 12), ink);
    e.position.set(sx * cx(9.68), cy(29), radiusAt(29) * 0.93);
    e.scale.z = 0.55;
    group.add(e);
  }
  const mouth = new THREE.Mesh(
    new THREE.CapsuleGeometry(cx(2.4), cx(7), 4, 8), ink
  );
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(0, cy(38), radiusAt(38) * 0.95);
  mouth.scale.z = 0.5;
  group.add(mouth);

  return { group, body };
}

/**
 * The ink outline, which is most of what makes it read as the drawing:
 * a copy of each mesh grown along its normals and drawn back-faces-only, so
 * it shows only as a rim around the silhouette.
 */
export function addOutline(group, thickness = 0.035) {
  const ink = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  const shells = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    const pos = g.attributes.position, nor = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i,
        pos.getX(i) + nor.getX(i) * thickness,
        pos.getY(i) + nor.getY(i) * thickness,
        pos.getZ(i) + nor.getZ(i) * thickness);
    }
    pos.needsUpdate = true;
    const shell = new THREE.Mesh(g, ink);
    shell.position.copy(o.position);
    shell.quaternion.copy(o.quaternion);
    shell.scale.copy(o.scale);
    shells.push(shell);
  });
  shells.forEach((s) => group.add(s));
  return group;
}
