import * as THREE from './three.module.min.js';
import { GLTFLoader } from './GLTFLoader.js';

// Assets must resolve against this module, not the page that imported it.
// From index.html at the site root, './egg-face-atlas.png' meant
// /egg-face-atlas.png, which 404s -- that is why the face was missing.
const asset = (p) => new URL(p, import.meta.url).href;
import { makeEggCharacter, addOutline, CREAM } from './egg-geometry.js';

/**
 * Paint directly on the egg.
 *
 * The body is UV-unwrapped, so a pointer press is: raycast to the mesh, read
 * the UV at the hit, and paint into a 2D canvas that IS the skin texture.
 * The brush itself is the same idea as the flat canvas in ../canvas.js --
 * only the target moved.
 *
 * Touch: painting and orbiting both want a one-finger drag, so there is a
 * mode, the same way the 2D canvas has a pan toggle.
 */

export const TEX = 512;
const BRUSH = 14;          // in texture pixels at penScale 1
const ERASER = 22;
const BASE = CREAM;        // the plain egg, before anyone paints on it

export function createPainter(container, opts = {}) {
  const TARGET = new THREE.Vector3(0, 0, 0);
  const state = {
    color: '#1a1a1a', erasing: false, penScale: 1,
    mode: 'paint',           // 'paint' | 'rotate' | 'pan'
    azimuth: 0, elevation: 0.12, dist: 3.4, dirty: false,
  };

  // --- the skin texture -------------------------------------------------
  const tex2d = document.createElement('canvas');
  tex2d.width = tex2d.height = TEX;
  const tctx = tex2d.getContext('2d', { willReadFrequently: false });
  function clear() {
    tctx.fillStyle = BASE;
    tctx.fillRect(0, 0, TEX, TEX);
    img = null;                 // the pixel buffer is stale now
    texture.needsUpdate = true;
    state.dirty = false;
  }

  const texture = new THREE.CanvasTexture(tex2d);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  // --- scene ------------------------------------------------------------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // The real model if it is there, the revolved placeholder if not. Only the
  // body takes the paint texture; the face is its own mesh either way, so a
  // stroke cannot wipe it off.
  const bodyMat = new THREE.MeshToonMaterial({ map: texture });
  let mesh = null;                       // the paint target
  let mixer = null;

  function frameGroup(g) {
    const box = new THREE.Box3().setFromObject(g);
    const size = new THREE.Vector3(), mid = new THREE.Vector3();
    box.getSize(size); box.getCenter(mid);
    g.position.sub(mid);                 // centre it on the origin
    const s = 1 / Math.max(size.x, size.y, size.z);
    g.scale.setScalar(s);                // normalise to roughly a unit tall
    g.position.multiplyScalar(s);
    scene.add(g);
    if (mesh) {
      scene.updateMatrixWorld(true);
      surf = buildSurfaceMap(mesh);
    }
  }

  function usePlaceholder() {
    const char = makeEggCharacter(bodyMat);
    mesh = char.body;
    addOutline(char.group);
    frameGroup(char.group);
  }

  new GLTFLoader().load(
    (opts.model || asset('./egg.glb')),
    (gltf) => {
      const root = gltf.scene;

      // The face is a quad whose UVs span the whole atlas; which expression
      // it shows was a Blender node offset that does not survive the glTF
      // export, so the material arrives as flat black. Re-apply the atlas
      // and pick the neutral cell: 3 columns, 2 rows, top-left.
      const faceTex = new THREE.TextureLoader().load(asset('./egg-face-atlas.png'));
      faceTex.colorSpace = THREE.SRGBColorSpace;
      faceTex.flipY = false;          // glTF UVs are top-down; the default
                                      // flip put the mouth above the eyes
      faceTex.repeat.set(1 / 3, 1 / 2);
      faceTex.offset.set(0, 0);       // top-left cell, with flipY off

      root.traverse((o) => {
        if (!o.isMesh && !o.isSkinnedMesh) return;
        // Only Egg_Body becomes the paint surface. Everything else keeps the
        // material it was exported with -- the model carries its own
        // M_Egg_Outline, so adding an inverted hull here would double it,
        // and a hull cloned off a SkinnedMesh does not deform with the rig.
        // Egg_Body is TWO primitives - the body and its outline - and
        // GLTFLoader splits them into two meshes with the same name, so
        // match on the material instead or the outline gets painted too.
        const mat = o.material && o.material.name;
        if (mat === 'M_Egg_Body') { o.material = bodyMat; mesh = o; }
        else if (mat === 'M_Egg_Face') {
          o.material = new THREE.MeshBasicMaterial({
            map: faceTex, transparent: true, alphaTest: 0.5,
            depthWrite: false, color: 0xffffff,
          });
          o.renderOrder = 2;
        }
      });
      if (!mesh) { usePlaceholder(); return; }
      frameGroup(root);
      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(root);
        const idle = gltf.animations.find((a) => /idle/i.test(a.name)) || gltf.animations[0];
        mixer.clipAction(idle).play();
      }
      if (opts.onReady) opts.onReady('model');
    },
    undefined,
    () => { usePlaceholder(); if (opts.onReady) opts.onReady('placeholder'); }
  );

  // Flat-ish lighting: the art style is an ink outline over flat colour, so
  // heavy shading would fight it.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(2, 3, 4);
  scene.add(key);

  clear();

  // --- painting ---------------------------------------------------------
  // Brush preview: a ring laid flat on the surface wherever the pointer is,
  // sized to the actual stroke. Without it you are guessing where a stroke
  // will land, which is the main thing the flat canvas gives you for free.
  const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: 0x1a1a1a, side: THREE.DoubleSide, transparent: true,
    opacity: 0.85, depthTest: false,
  }));
  ring.renderOrder = 10;
  ring.visible = false;
  scene.add(ring);

  /*
   * Painting on the SURFACE, not in the texture.
   *
   * Every earlier version drew into the texture directly: take the UV under
   * the pointer and stamp a shape there. That can never be quite right. The
   * unwrap stretches, so a round stamp lands as an ellipse near the crown
   * and the brush changes size as you move; and the body, arms and legs are
   * separate islands, so a stroke that crosses from one to the next either
   * tears or smears across whatever lies between them in the atlas.
   *
   * So: remember where every texel IS on the model, then paint by distance
   * in 3D. A stroke is a capsule -- the segment the pointer travelled, with
   * the brush radius around it -- and a texel gets paint when its point on
   * the surface falls inside that capsule. Seams, islands and poles stop
   * mattering, because the texture layout stops being part of the question.
   */
  let surf = null;            // { pos: Float32Array, mask: Uint8Array, unit }

  function buildSurfaceMap(m) {
    const g = m.geometry;
    const pos = g.attributes.position, uv = g.attributes.uv;
    if (!uv) return null;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const map = new Float32Array(TEX * TEX * 3);
    const mask = new Uint8Array(TEX * TEX);

    // texel centre of a UV, in canvas pixels -- the same flip dot() used
    const px = (u) => u * TEX;
    const py = (v) => (1 - v) * TEX;

    for (let t = 0; t < n; t += 3) {
      const ia = idx ? idx.getX(t) : t;
      const ib = idx ? idx.getX(t + 1) : t + 1;
      const ic = idx ? idx.getX(t + 2) : t + 2;
      const ax = px(uv.getX(ia)), ay = py(uv.getY(ia));
      const bx = px(uv.getX(ib)), by = py(uv.getY(ib));
      const cx = px(uv.getX(ic)), cy = py(uv.getY(ic));
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (!det) continue;

      // half a texel of bleed, so neighbouring triangles do not leave a gap
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1));
      const x1 = Math.min(TEX - 1, Math.ceil(Math.max(ax, bx, cx) + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1));
      const y1 = Math.min(TEX - 1, Math.ceil(Math.max(ay, by, cy) + 1));

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const sx = x + 0.5, sy = y + 0.5;
          let l1 = ((by - cy) * (sx - cx) + (cx - bx) * (sy - cy)) / det;
          let l2 = ((cy - ay) * (sx - cx) + (ax - cx) * (sy - cy)) / det;
          let l3 = 1 - l1 - l2;
          if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
          const o = (y * TEX + x);
          if (mask[o]) continue;
          mask[o] = 1;
          map[o * 3] = pos.getX(ia) * l1 + pos.getX(ib) * l2 + pos.getX(ic) * l3;
          map[o * 3 + 1] = pos.getY(ia) * l1 + pos.getY(ib) * l2 + pos.getY(ic) * l3;
          map[o * 3 + 2] = pos.getZ(ia) * l1 + pos.getZ(ib) * l2 + pos.getZ(ic) * l3;
        }
      }
    }

    // How big one texel is on the model, averaged over the whole surface.
    // The brush is quoted in texture pixels, and this is what turns that
    // into a distance in space -- one number for the whole body, which is
    // the point: the brush is the same size wherever you put it.
    let sum = 0, cnt = 0;
    for (let y = 0; y < TEX; y++) {
      for (let x = 0; x < TEX - 1; x++) {
        const o = y * TEX + x;
        if (!mask[o] || !mask[o + 1]) continue;
        sum += Math.hypot(map[o * 3] - map[(o + 1) * 3],
                          map[o * 3 + 1] - map[(o + 1) * 3 + 1],
                          map[o * 3 + 2] - map[(o + 1) * 3 + 2]);
        cnt++;
      }
    }
    return { pos: map, mask, unit: cnt ? sum / cnt : 0.004 };
  }

  /*
   * The pointer's hit, as a point in the mesh's own un-posed space.
   *
   * hit.point is where the ray met the body as it is POSED this frame, and
   * the idle animation never stops, so that moves under us. The surface map
   * is built from the bind pose, so convert through the one thing that does
   * not move: the hit's barycentric position inside its triangle, recovered
   * from the UVs the raycaster already interpolated.
   */
  function restPoint(hit) {
    const g = hit.object.geometry, f = hit.face;
    if (!f || !g.attributes.uv) return null;
    const uv = g.attributes.uv, pos = g.attributes.position;
    const ax = uv.getX(f.a), ay = uv.getY(f.a);
    const bx = uv.getX(f.b), by = uv.getY(f.b);
    const cx = uv.getX(f.c), cy = uv.getY(f.c);
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (!det) return null;
    const sx = hit.uv.x, sy = hit.uv.y;
    const l1 = ((by - cy) * (sx - cx) + (cx - bx) * (sy - cy)) / det;
    const l2 = ((cy - ay) * (sx - cx) + (ax - cx) * (sy - cy)) / det;
    const l3 = 1 - l1 - l2;
    return new THREE.Vector3(
      pos.getX(f.a) * l1 + pos.getX(f.b) * l2 + pos.getX(f.c) * l3,
      pos.getY(f.a) * l1 + pos.getY(f.b) * l2 + pos.getY(f.c) * l3,
      pos.getZ(f.a) * l1 + pos.getZ(f.b) * l2 + pos.getZ(f.c) * l3,
    );
  }

  function showRing(hit) {
    if (!hit) { ring.visible = false; return; }
    ring.position.copy(hit.point);
    const n = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : new THREE.Vector3(0, 0, 1);
    ring.lookAt(hit.point.clone().add(n));
    ring.position.addScaledVector(n, 0.004);   // lift it off the surface
    ring.scale.setScalar(Math.max(0.002, brushWorld()));
    ring.material.color.set(state.erasing ? 0x888888 : state.color);
    ring.visible = true;
  }

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let painting = false, lastPointer = null, lastRest = null, lastHit = null;

  function brushPx() {
    return (state.erasing ? ERASER : BRUSH) * state.penScale;
  }
  /** The brush radius as a distance on the model, not a count of texels. */
  function brushRadius() {
    return (brushPx() / 2) * (surf ? surf.unit : 0.004);
  }
  /** ...and in world units, for the preview ring, which lives in the scene. */
  function brushWorld() {
    return brushRadius() * (mesh ? mesh.getWorldScale(_ws).x : 1);
  }
  const _ws = new THREE.Vector3();

  /** Where the ray meets the body, or null. Leaves the hit in lastHit. */
  function hitAt(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    // body only -- the face and limbs are not paint targets
    if (!mesh) { lastHit = null; return null; }
    const hit = ray.intersectObject(mesh, false)[0] || null;
    lastHit = hit && hit.uv ? hit : null;
    return lastHit;
  }

  // the texture, as pixels we can write to directly. Painting by distance
  // means touching scattered texels, which a 2D path cannot express.
  let img = null;
  const rgb = { r: 0, g: 0, b: 0 };
  function parseHex(h) {
    const v = parseInt(h.replace('#', ''), 16);
    rgb.r = (v >> 16) & 255; rgb.g = (v >> 8) & 255; rgb.b = v & 255;
  }

  /**
   * Lay paint along the segment a->b on the surface: every texel whose point
   * on the model is within the brush radius of that segment. a may be null
   * for a single dab.
   */
  function paintSegment(a, b) {
    if (!surf) return;
    if (!img) img = tctx.getImageData(0, 0, TEX, TEX);
    parseHex(state.erasing ? BASE : state.color);
    const R = brushRadius();
    // one texel's worth of softness on the rim, so edges are not stair-stepped
    const soft = Math.max(surf.unit, 1e-6);
    const outer = R + soft, outer2 = outer * outer;
    const ax = a ? a.x : b.x, ay = a ? a.y : b.y, az = a ? a.z : b.z;
    const ex = b.x - ax, ey = b.y - ay, ez = b.z - az;
    const len2 = ex * ex + ey * ey + ez * ez;
    const P = surf.pos, M = surf.mask, D = img.data;

    for (let o = 0, n = TEX * TEX; o < n; o++) {
      if (!M[o]) continue;
      const o3 = o * 3;
      // distance from this texel's point to the segment
      let dx = P[o3] - ax, dy = P[o3 + 1] - ay, dz = P[o3 + 2] - az;
      if (len2 > 0) {
        let t = (dx * ex + dy * ey + dz * ez) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        dx -= ex * t; dy -= ey * t; dz -= ez * t;
      }
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > outer2) continue;
      let k = (outer - Math.sqrt(d2)) / soft;     // 1 inside, 0 at the rim
      if (k > 1) k = 1;
      const o4 = o * 4;
      D[o4] += (rgb.r - D[o4]) * k;
      D[o4 + 1] += (rgb.g - D[o4 + 1]) * k;
      D[o4 + 2] += (rgb.b - D[o4 + 2]) * k;
      D[o4 + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
    texture.needsUpdate = true;
  }

  // --- pointer ----------------------------------------------------------
  function down(e) {
    const p = pointer(e);
    lastPointer = p;
    if (state.mode !== 'paint') return;   // pan has to bail here too, or a pan-drag drops a dot
    const hit = hitAt(p.x, p.y);
    if (!hit) return;
    painting = true; state.dirty = true;
    lastRest = restPoint(hit);
    if (lastRest) paintSegment(null, lastRest);
    e.preventDefault();
  }
  function move(e) {
    const p = pointer(e);
    if (state.mode === 'rotate' && lastPointer) {
      state.azimuth -= (p.x - lastPointer.x) * 0.01;
      state.elevation = Math.max(-1.2, Math.min(1.2,
        state.elevation + (p.y - lastPointer.y) * 0.01));
      lastPointer = p;
      e.preventDefault();
      return;
    }
    if (state.mode === 'pan' && lastPointer) {
      // move the look-at point in the camera's own plane, scaled by distance
      // so panning feels the same however far out you are
      const k = state.dist * 0.0016;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      TARGET.addScaledVector(right, -(p.x - lastPointer.x) * k);
      TARGET.addScaledVector(up, (p.y - lastPointer.y) * k);
      lastPointer = p;
      e.preventDefault();
      return;
    }
    const hit = hitAt(p.x, p.y);
    showRing(state.mode === 'paint' ? lastHit : null);
    if (!painting) return;
    if (hit) {
      const here = restPoint(hit);
      if (here) { paintSegment(lastRest, here); lastRest = here; }
    }
    e.preventDefault();
  }
  function up() { painting = false; lastPointer = null; lastRest = null; }

  const pointer = (e) => e.touches && e.touches[0]
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
    : { x: e.clientX, y: e.clientY };

  const ZOOM_MIN = 1.6, ZOOM_MAX = 8;
  function zoomBy(f) {
    state.dist = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.dist * f));
  }
  function resetView() {
    state.azimuth = 0; state.elevation = 0.12; state.dist = 3.4;
    TARGET.set(0, 0, 0);
  }

  const el = renderer.domElement;
  el.addEventListener('wheel', (e) => { zoomBy(e.deltaY > 0 ? 1.1 : 0.9); e.preventDefault(); },
    { passive: false });

  // two fingers: pinch to zoom, drag to pan -- so touch gets both without
  // another mode button
  let pinch = null;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) { painting = false; pinch = touchPair(e); }
  }, { passive: false });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinch) return;
    const now = touchPair(e);
    zoomBy(pinch.d / now.d);
    const k = state.dist * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    TARGET.addScaledVector(right, -(now.x - pinch.x) * k);
    TARGET.addScaledVector(up, (now.y - pinch.y) * k);
    pinch = now;
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchend', () => { pinch = null; });
  const touchPair = (e) => {
    const [a, b] = [e.touches[0], e.touches[1]];
    return {
      x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2,
      d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
    };
  };

  el.addEventListener('mouseleave', () => { ring.visible = false; });
  el.addEventListener('mousedown', down);
  el.addEventListener('touchstart', down, { passive: false });
  addEventListener('mousemove', move);
  el.addEventListener('touchmove', move, { passive: false });
  addEventListener('mouseup', up);
  addEventListener('touchend', up);

  // --- loop -------------------------------------------------------------
  function resize() {
    const w = container.clientWidth, h = container.clientHeight || w;
    renderer.setSize(w, h);   // updateStyle on: without it the canvas
                              // renders at devicePixelRatio size and overflows
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const clock = new THREE.Clock();
  function frame() {
    // Both the painter and the meadow live on the same page now; whichever
    // is hidden should not be burning a render loop.
    if (container.offsetParent === null) { requestAnimationFrame(frame); return; }
    if (mixer) mixer.update(clock.getDelta());
    const r = state.dist;
    camera.position.set(
      TARGET.x + Math.sin(state.azimuth) * Math.cos(state.elevation) * r,
      TARGET.y + Math.sin(state.elevation) * r,
      TARGET.z + Math.cos(state.azimuth) * Math.cos(state.elevation) * r
    );
    camera.lookAt(TARGET);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  resize();
  addEventListener('resize', resize);
  frame();

  return {
    state,
    clear,
    setColor: (c) => { state.color = c; state.erasing = false; },
    setErasing: (on) => { state.erasing = on; },
    setPenScale: (n) => { state.penScale = n; },
    setMode: (m) => { state.mode = m; },
    zoomIn: () => zoomBy(0.85),
    zoomOut: () => zoomBy(1.18),
    resetView,
    hasDrawn: () => state.dirty,
    /** The painted skin, for the existing submit flow. */
    toDataURL: () => tex2d.toDataURL('image/png'),
  };
}
