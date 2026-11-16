"""Export the egg as a web-ready .glb for the playground.

Companion to RacerProto's egg-design/blender/scripts/export.py, which writes
FBX for Unity. This writes glTF for Three.js instead: same rig, same clips,
one file, textures left out because the playground paints its own.

Run from Blender's scripting tab with egg.blend open:

    exec(open(r"<path>\export_egg_gltf.py").read()); export_glb()

or headless:

    blender egg.blend --background --python export_egg_gltf.py -- out.glb

Then commit the .glb to PW_kwakd at PW_v3/playground/3d/egg.glb.
"""
import bpy, os, sys

# Only what the meadow and the paint view need. Keeping the clip list short
# matters: every extra action is bytes on a page that currently costs 0.32 MB.
CLIPS = ("Anim_Idle", "Anim_Run")   # there is no Anim_Walk; Run slowed down reads as a wander

DEFAULT_OUT = os.path.join(os.path.dirname(bpy.data.filepath or "."), "egg.glb")


def _body_objects():
    """The base egg only - no accessories, no skin add-ons."""
    keep = []
    for o in bpy.data.objects:
        if o.type == 'ARMATURE':
            keep.append(o)
        elif o.type == 'MESH' and o.name in ("Egg_Body", "Egg_Face"):
            keep.append(o)
    if not keep:
        raise RuntimeError("found no Egg_Body/Egg_Face/armature - is egg.blend open?")
    return keep


def _only_wanted_actions():
    """Drop every action that is not a clip we want.

    export_animation_mode='ACTIONS' exports all 24 of them otherwise, which
    is most of the file size for a meadow that only idles and walks. This
    edits the in-memory scene; do not save over egg.blend.
    """
    for a in list(bpy.data.actions):
        if a.name not in CLIPS:
            bpy.data.actions.remove(a)
    for o in bpy.data.objects:
        ad = getattr(o, "animation_data", None)
        if not ad:
            continue
        for tr in list(ad.nla_tracks):
            if tr.name not in CLIPS:
                ad.nla_tracks.remove(tr)


def export_glb(out=None):
    out = out or DEFAULT_OUT
    objs = _body_objects()
    _only_wanted_actions()

    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.hide_set(False)
        o.hide_viewport = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=True,
        export_apply=True,          # bake modifiers
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_bake_animation=True,
        export_yup=True,            # glTF is Y-up, same as three.js
        export_materials='NONE',    # the playground paints its own texture
        export_image_format='NONE',
        export_skins=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f"wrote {out} ({os.path.getsize(out)/1024:.0f} KB)")
    return out


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    export_glb(argv[0] if argv else None)
