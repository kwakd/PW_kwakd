import * as THREE from './three.module.min.js';
import { GLTFLoader } from './GLTFLoader.js';

// Assets must resolve against this module, not the page that imported it.
// From index.html at the site root, './egg-face-atlas.png' meant
// /egg-face-atlas.png, which 404s -- that is why the face was missing.
const asset = (p) => new URL(p, import.meta.url).href;
import { clone as cloneSkinned } from './SkeletonUtils.js';

/**
 * The meadow: every approved egg wanders here, and clicking one shows what
 * its maker wrote.
 *
 * The look is the Animal Crossing trick -- the ground does not curve, the
 * SHADER bends it. Each vertex is pushed down by the square of its distance
 * from the camera, so the world falls away at the edges and you appear to be
 * standing on a small planet. It costs a few lines in the vertex shader and
 * nothing at runtime.
 */

// How hard the world falls away.
//
// Depth-only curving gives the Animal Crossing horizon, but it stays flat
// left to right, so it never reads as a globe. Bending RADIALLY - by
// distance from the camera's own ground point, in every direction - makes
// the edges fall away all round and the meadow becomes a little planet.
//
// The camera's focus point has to be exempt or the whole scene sinks: the
// drop is measured from the pivot, not from the camera, so the ground under
// the eggs stays put while everything further out curls down.
const CURVE = 0.016;
const FIELD = 26;           // metres across
const WANDER_SPEED = 0.55;

// Everything curves about this point, so the ground under the camera stays
// level and the planet falls away around it.
const pivotWorld = new THREE.Vector3(0, 0, 0);

/** Bend a material's vertices down with distance, in view space. */
function curveMaterial(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCurve = { value: CURVE };
    shader.uniforms.uPivot = { value: pivotWorld };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uCurve;\nuniform vec3 uPivot;')
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
         #ifdef USE_INSTANCING
           mvPosition = instanceMatrix * mvPosition;
         #endif
         mvPosition = modelViewMatrix * mvPosition;
         // the whole trick: drop every vertex by the square of how far it
         // is from the pivot ACROSS the ground, in all directions, so the
         // meadow curls away on every side like a small planet
         vec4 worldPos = modelMatrix * vec4( transformed, 1.0 );
         #ifdef USE_INSTANCING
           worldPos = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
         #endif
         float d = distance( worldPos.xz, uPivot.xz );
         mvPosition.y -= uCurve * d * d;
         gl_Position = projectionMatrix * mvPosition;`
      );
  };
  mat.customProgramCacheKey = () => 'curved';
  return mat;
}

export function createMeadow(container, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe3f2);
  scene.fog = new THREE.Fog(0xbfe3f2, 20, 42);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // an angled, slightly-above view, which is what sells the curvature
  const view = { azimuth: 0, elevation: 0.52, dist: 15, target: new THREE.Vector3() };

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9fc08a, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(4, 8, 5);
  scene.add(key);

  const ground = new THREE.Mesh(
    // RingGeometry, not CircleGeometry: a circle is a fan with a single
    // ring of triangles, so bending it in the vertex shader can only move
    // the centre and the rim and the "dome" is really a cone. The eggs,
    // being small meshes, bent correctly - which is why they floated above
    // it. 40 radial divisions gives a smooth surface for them to sit on.
    new THREE.RingGeometry(0.0001, FIELD, 128, 40).rotateX(-Math.PI / 2),
    curveMaterial(new THREE.MeshToonMaterial({ color: 0x94c97a }))
  );
  scene.add(ground);

  const eggs = [];            // { group, mixer, data, dir, turnIn }
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let template = null;

  // ---- loading -----------------------------------------------------------
  const loader = new GLTFLoader();
  const modelReady = new Promise((res, rej) =>
    loader.load(opts.model || asset('./egg.glb'), (g) => res(g), undefined, rej)
  );

  const faceTex = new THREE.TextureLoader().load(asset('./egg-face-atlas.png'));
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.flipY = false;
  faceTex.repeat.set(1 / 3, 1 / 2);
  faceTex.offset.set(0, 0);

  /*
   * A painted skin, set up exactly as the painter had it -- anything else and
   * the character here does not match what its maker drew.
   *
   * No flipY. The face atlas above needs it off because that PNG is authored
   * top-down to match the glTF UVs, but a skin is a dump of the painter's own
   * canvas, which is already in the default (flipped) convention. Turning it
   * off here too mirrored every skin vertically: paint on the head came out
   * on the belly, and the parts people had covered showed up bare.
   *
   * No mipmaps either. The skin is one atlas with empty gaps between the
   * islands, and characters are small on screen out here, so the lower mip
   * levels average those gaps back in as pale patches.
   */
  function skinTexture(dataUrl) {
    const t = new THREE.TextureLoader().load(dataUrl);
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.anisotropy = 4;
    return t;
  }

  /** One wandering egg, wearing the skin its maker painted. */
  function addEgg(data, gltf) {
    const g = cloneSkinned(gltf.scene);
    const skin = data.image_data ? skinTexture(data.image_data) : null;
    g.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      const name = o.material && o.material.name;
      if (name === 'M_Egg_Body') {
        o.material = curveMaterial(new THREE.MeshToonMaterial(
          skin ? { map: skin } : { color: 0xece4d6 }
        ));
      } else if (name === 'M_Egg_Face') {
        o.material = curveMaterial(new THREE.MeshBasicMaterial({
          map: faceTex, transparent: true, alphaTest: 0.5, depthWrite: false,
        }));
      } else {
        o.material = curveMaterial(o.material.clone());
      }
      o.userData.eggId = data.id;
    });

    // normalise height, then scatter
    const box = new THREE.Box3().setFromObject(g);
    const size = new THREE.Vector3(); box.getSize(size);
    g.scale.setScalar(1 / size.y);
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (FIELD * 0.42);
    g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);

    const mixer = new THREE.AnimationMixer(g);
    const clips = gltf.animations || [];
    const walk = clips.find((c) => /run|walk/i.test(c.name)) || clips[0];
    const idle = clips.find((c) => /idle/i.test(c.name)) || clips[0];
    const actions = {
      walk: walk ? mixer.clipAction(walk) : null,
      idle: idle ? mixer.clipAction(idle) : null,
    };
    if (actions.walk) actions.walk.timeScale = 0.55;   // a wander, not a sprint
    (actions.idle || actions.walk)?.play();

    const egg = {
      group: g, mixer, actions, data,
      heading: Math.random() * Math.PI * 2,
      state: 'idle',
      timer: 1 + Math.random() * 3,
    };
    scene.add(g);
    eggs.push(egg);
    return egg;
  }

  async function load(characters) {
    const gltf = await modelReady;
    template = gltf;
    characters.forEach((c) => addEgg(c, gltf));
    return eggs.length;
  }

  // ---- wandering ---------------------------------------------------------
  function step(dt) {
    for (const e of eggs) {
      e.mixer.update(dt);
      e.timer -= dt;
      if (e.timer <= 0) {
        // flip between standing about and ambling somewhere else
        const walking = e.state === 'walk';
        e.state = walking ? 'idle' : 'walk';
        e.timer = walking ? 1.5 + Math.random() * 3 : 2 + Math.random() * 4;
        if (!walking) e.heading += (Math.random() - 0.5) * Math.PI;
        const from = walking ? e.actions.walk : e.actions.idle;
        const to = walking ? e.actions.idle : e.actions.walk;
        if (from && to) { to.reset().play(); from.crossFadeTo(to, 0.35, false); }
      }
      if (e.state !== 'walk') continue;
      const p = e.group.position;
      p.x += Math.sin(e.heading) * WANDER_SPEED * dt;
      p.z += Math.cos(e.heading) * WANDER_SPEED * dt;
      // turn back rather than wander off the edge
      if (Math.hypot(p.x, p.z) > FIELD * 0.42) {
        e.heading = Math.atan2(-p.x, -p.z) + (Math.random() - 0.5) * 0.6;
      }
      e.group.rotation.y = e.heading;
    }
  }

  // ---- interaction -------------------------------------------------------
  /**
   * Where an egg actually APPEARS, which is not where it is.
   *
   * The curve lives in the vertex shader, on the GPU, so the scene graph
   * still has everything on a flat plane. Raycasting against that missed by
   * however far the shader had moved it -- up to three metres out at the
   * edge of the field, which is why a character you could plainly see was
   * unclickable.
   */
  const _p = new THREE.Vector3();
  function screenOf(egg) {
    _p.copy(egg.group.position);
    _p.y += 0.55;                                   // aim at the body, not the feet
    const d = Math.hypot(_p.x - pivotWorld.x, _p.z - pivotWorld.z);
    _p.y -= CURVE * d * d;                          // the same bend the shader applies
    _p.project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return {
      x: r.left + (_p.x * 0.5 + 0.5) * r.width,
      y: r.top + (-_p.y * 0.5 + 0.5) * r.height,
      behind: _p.z > 1,
    };
  }

  /** Nearest egg to the pointer, in screen space, within a forgiving radius. */
  function eggAt(clientX, clientY) {
    let best = null, bestD = Infinity;
    for (const e of eggs) {
      const s = screenOf(e);
      if (s.behind) continue;
      const d = Math.hypot(s.x - clientX, s.y - clientY);
      if (d < bestD) { bestD = d; best = e; }
    }
    // generous but not absurd: roughly the on-screen size of an egg
    const r = renderer.domElement.getBoundingClientRect();
    const limit = Math.max(28, r.width * 0.06);
    return bestD <= limit ? best : null;
  }

  const el = renderer.domElement;
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    // right button, middle button or shift drags the view instead of turning it
    drag = { x: e.clientX, y: e.clientY, moved: 0,
             pan: e.button === 1 || e.button === 2 || e.shiftKey };
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  // arrow keys and WASD walk around, for anyone who would rather not drag
  el.tabIndex = 0;
  el.addEventListener('keydown', (e) => {
    const step = 34;
    const moves = {
      ArrowLeft: [-step, 0], a: [-step, 0], ArrowRight: [step, 0], d: [step, 0],
      ArrowUp: [0, -step], w: [0, -step], ArrowDown: [0, step], s: [0, step],
    };
    const m = moves[e.key];
    if (!m) return;
    panBy(-m[0], -m[1]);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) {
      el.style.cursor = eggAt(e.clientX, e.clientY) ? 'pointer' : 'grab';
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.pan) {
      panBy(dx, dy);
    } else {
      view.azimuth -= dx * 0.005;
      view.elevation = Math.max(0.15, Math.min(1.3, view.elevation + dy * 0.004));
    }
    drag.x = e.clientX; drag.y = e.clientY;
  });

  /** Walk the view across the meadow, in the camera's own plane. */
  function panBy(dx, dy) {
    const k = view.dist * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const fwd = right.clone().cross(new THREE.Vector3(0, 1, 0));
    view.target.addScaledVector(right, -dx * k);
    view.target.addScaledVector(fwd, dy * k);
    const lim = FIELD * 0.5;
    view.target.x = Math.max(-lim, Math.min(lim, view.target.x));
    view.target.z = Math.max(-lim, Math.min(lim, view.target.z));
  }
  el.addEventListener('pointerup', (e) => {
    const wasClick = drag && drag.moved < 6;
    drag = null;
    if (!wasClick) return;
    const hit = eggAt(e.clientX, e.clientY);
    if (opts.onSelect) opts.onSelect(hit ? hit.data : null);
  });
  el.addEventListener('pointerleave', () => { drag = null; });

  let pinch = null;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) { drag = null; pinch = touchPair(e); }
  }, { passive: false });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinch) return;
    const now = touchPair(e);
    view.dist = Math.max(6, Math.min(30, view.dist * (pinch.d / now.d)));
    panBy(now.x - pinch.x, now.y - pinch.y);
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
  el.addEventListener('wheel', (e) => {
    view.dist = Math.max(6, Math.min(30, view.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
    e.preventDefault();
  }, { passive: false });

  // ---- loop --------------------------------------------------------------
  function resize() {
    const w = container.clientWidth, h = container.clientHeight || Math.round(w * 0.62);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const clock = new THREE.Clock();
  function frame() {
    // Both the painter and the meadow live on the same page now; whichever
    // is hidden should not be burning a render loop.
    if (container.offsetParent === null) { requestAnimationFrame(frame); return; }
    const dt = Math.min(clock.getDelta(), 0.1);
    step(dt);
    const { azimuth, elevation, dist, target } = view;
    camera.position.set(
      target.x + Math.sin(azimuth) * Math.cos(elevation) * dist,
      target.y + Math.sin(elevation) * dist,
      target.z + Math.cos(azimuth) * Math.cos(elevation) * dist
    );
    camera.lookAt(target);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  resize();
  addEventListener('resize', resize);
  frame();

  return { load, eggs, view, count: () => eggs.length };
}
