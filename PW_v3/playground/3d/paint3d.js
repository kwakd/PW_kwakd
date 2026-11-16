import * as THREE from './three.module.min.js';
import { GLTFLoader } from './GLTFLoader.js';
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
    measureTexelScale();
  }

  function usePlaceholder() {
    const char = makeEggCharacter(bodyMat);
    mesh = char.body;
    addOutline(char.group);
    frameGroup(char.group);
  }

  new GLTFLoader().load(
    (opts.model || './egg.glb'),
    (gltf) => {
      const root = gltf.scene;

      // The face is a quad whose UVs span the whole atlas; which expression
      // it shows was a Blender node offset that does not survive the glTF
      // export, so the material arrives as flat black. Re-apply the atlas
      // and pick the neutral cell: 3 columns, 2 rows, top-left.
      const faceTex = new THREE.TextureLoader().load('./egg-face-atlas.png');
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

  // How much world space one texture pixel covers, so the ring matches the
  // brush. The body's circumference maps to u 0..1, i.e. TEX pixels across.
  let worldPerTexel = 0.006;
  function measureTexelScale() {
    if (!mesh) return;
    scene.updateMatrixWorld(true);   // world scale is stale until this runs
    mesh.geometry.computeBoundingSphere();
    const r = mesh.geometry.boundingSphere.radius
      * mesh.getWorldScale(new THREE.Vector3()).x;
    worldPerTexel = (2 * Math.PI * r) / TEX;
  }

  function showRing(hit) {
    if (!hit) { ring.visible = false; return; }
    ring.position.copy(hit.point);
    const n = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : new THREE.Vector3(0, 0, 1);
    ring.lookAt(hit.point.clone().add(n));
    ring.position.addScaledVector(n, 0.004);   // lift it off the surface
    ring.scale.setScalar(Math.max(0.004, (brushWidth() / 2) * worldPerTexel));
    ring.material.color.set(state.erasing ? 0x888888 : state.color);
    ring.visible = true;
  }

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let painting = false, lastUV = null, lastPointer = null;

  function brushPx() {
    return (state.erasing ? ERASER : BRUSH) * state.penScale;
  }

  function uvAt(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    // body only -- the face and limbs are not paint targets
    if (!mesh) return null;
    const hit = ray.intersectObject(mesh, false)[0];
    lastHit = hit || null;
    return hit && hit.uv ? { u: hit.uv.x, v: hit.uv.y } : null;
  }
  let lastHit = null;

  /** A stroke between two UVs, skipped if it jumps a seam. */
  function stroke(a, b) {
    tctx.strokeStyle = state.erasing ? BASE : state.color;
    tctx.fillStyle = tctx.strokeStyle;
    tctx.lineWidth = brushPx();
    tctx.lineCap = tctx.lineJoin = 'round';
    const ax = a.u * TEX, ay = (1 - a.v) * TEX;
    const bx = b.u * TEX, by = (1 - b.v) * TEX;
    // u wraps at the seam; a jump over half the texture is the pointer
    // crossing it, not a real stroke, so draw a dot instead of a smear.
    if (Math.abs(b.u - a.u) > 0.5) { dot(b); return; }
    tctx.beginPath();
    tctx.moveTo(ax, ay);
    tctx.lineTo(bx, by);
    tctx.stroke();
    texture.needsUpdate = true;
  }

  function dot(p) {
    tctx.fillStyle = state.erasing ? BASE : state.color;
    tctx.beginPath();
    tctx.arc(p.u * TEX, (1 - p.v) * TEX, brushPx() / 2, 0, Math.PI * 2);
    tctx.fill();
    texture.needsUpdate = true;
  }

  // --- pointer ----------------------------------------------------------
  function down(e) {
    const p = pointer(e);
    lastPointer = p;
    if (state.mode === 'rotate') return;
    const uv = uvAt(p.x, p.y);
    if (!uv) return;
    painting = true; lastUV = uv; state.dirty = true;
    dot(uv);
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
    const uv = uvAt(p.x, p.y);
    showRing(state.mode === 'paint' ? lastHit : null);
    if (!painting) return;
    if (uv) { if (lastUV) stroke(lastUV, uv); lastUV = uv; }
    e.preventDefault();
  }
  function up() { painting = false; lastUV = null; lastPointer = null; }

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
