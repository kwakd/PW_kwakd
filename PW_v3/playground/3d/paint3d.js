import * as THREE from './three.module.min.js';
import { makeEggGeometry } from './egg-geometry.js';

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
const BASE = '#f6f3ea';    // the plain white egg

export function createPainter(container, opts = {}) {
  const state = {
    color: '#1a1a1a', erasing: false, penScale: 1,
    mode: 'paint',           // 'paint' | 'rotate'
    azimuth: 0, elevation: 0.12, dirty: false,
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

  const mesh = new THREE.Mesh(
    makeEggGeometry(),
    new THREE.MeshToonMaterial({ map: texture })
  );
  scene.add(mesh);

  // Flat-ish lighting: the art style is an ink outline over flat colour, so
  // heavy shading would fight it.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(2, 3, 4);
  scene.add(key);

  clear();

  // --- painting ---------------------------------------------------------
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
    const hit = ray.intersectObject(mesh, false)[0];
    return hit && hit.uv ? { u: hit.uv.x, v: hit.uv.y } : null;
  }

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
    if (!painting) return;
    const uv = uvAt(p.x, p.y);
    if (uv) { if (lastUV) stroke(lastUV, uv); lastUV = uv; }
    e.preventDefault();
  }
  function up() { painting = false; lastUV = null; lastPointer = null; }

  const pointer = (e) => e.touches && e.touches[0]
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
    : { x: e.clientX, y: e.clientY };

  const el = renderer.domElement;
  el.addEventListener('mousedown', down);
  el.addEventListener('touchstart', down, { passive: false });
  addEventListener('mousemove', move);
  el.addEventListener('touchmove', move, { passive: false });
  addEventListener('mouseup', up);
  addEventListener('touchend', up);

  // --- loop -------------------------------------------------------------
  function resize() {
    const w = container.clientWidth, h = container.clientHeight || w;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function frame() {
    const r = 3.4;
    camera.position.set(
      Math.sin(state.azimuth) * Math.cos(state.elevation) * r,
      Math.sin(state.elevation) * r,
      Math.cos(state.azimuth) * Math.cos(state.elevation) * r
    );
    camera.lookAt(0, 0, 0);
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
    hasDrawn: () => state.dirty,
    /** The painted skin, for the existing submit flow. */
    toDataURL: () => tex2d.toDataURL('image/png'),
  };
}
