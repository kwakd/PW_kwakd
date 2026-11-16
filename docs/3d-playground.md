# 3D playground — design

Replaces the flat drawing canvas on index.html with a 3D one: paint the egg
itself, submit it, and once approved it wanders a meadow you can click into.

Decided 2026-11-15. Three choices were made up front and the rest follows
from them:

- **Paint directly on the model.** Not a flat skin sheet beside a preview.
- **One codebase, touch-tuned.** No separate mobile path.
- **No photo uploads yet.** Title and message only; photos can come later
  without redoing anything.

## Why this is tractable

The body is already UV-unwrapped — RacerProto ships 51 `Egg_Skin_*.png`
textures against one layout. So painting on the egg is not arbitrary 3D
painting: raycast from the pointer to the mesh, read the UV at the hit, paint
into a 2D canvas that *is* the skin. The existing brush, swatches, eraser and
pen-size code all carry over; only the paint target changes.

## Stack

**Three.js**, self-hosted rather than from a CDN. Not Unity: a WebGL build
would be ~25 MB, the size of the gat-cha fish embed, against the 0.32 MB the
whole landing page costs today. The meadow loads only when someone opens it.

## Pipeline

```
egg.blend ──(export_egg_gltf.py)──> egg.glb ──> paint view ──> meadow
   Blender, on Windows               ~200 KB      three.js      three.js
```

`playground/3d/export_egg_gltf.py` is the Blender side: same rig as the Unity
export, Idle and Walk only, no materials (the playground paints its own).

## Data

The existing flow is unchanged — Netlify function, `status = 'pending'`,
manual approval in the Supabase dashboard.

`image_data` carries a 512×512 painted skin instead of a 180×180 doodle, so
rows get bigger; worth watching if submissions ever pick up. The click card
needs the posted date, which `created_at` already has.

No schema change is required for this phase. Photos would need a
`photo_path` and a private Storage bucket.

## Open problems

- **Seams.** A stroke crossing a UV seam paints two disconnected places on
  the texture. Mitigation is painting into a slightly dilated texture and
  letting the shader sample inside the island.
- **Touch gestures.** Painting and rotating both want a one-finger drag.
  Follow the existing canvas: a mode toggle, like the pan button already
  there.
- **Payload.** three.js plus the model must stay lazy-loaded. The landing
  page is 0.32 MB and should stay close to it until someone opts in.

## Meadow

Approved eggs wander on a curved "Animal Crossing" world — about fifteen
lines of GLSL in the vertex shader bending world space down with distance
from the camera. Click an egg for its title, message and date.
