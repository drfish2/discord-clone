# Blender headless batch converter for the OSRF gazebo_models vehicles
# (CC-BY 3.0). Imports each model's OBJ (Z-up, inch/percent scales) or DAE,
# bakes the SDF yaw + scale, and exports a plain GLB per model.
# Usage: blender -b --python batch_gazebo.py -- <srcRoot> <outDir>
import bpy, os, re, sys, math

SRC = sys.argv[sys.argv.index('--') + 1]
OUT = sys.argv[sys.argv.index('--') + 2]
os.makedirs(OUT, exist_ok=True)
TMP = os.path.join(OUT, '_tmp')
os.makedirs(TMP, exist_ok=True)

# (folder, output name, format, sdf scale, extra yaw degrees)
# yaw = in-Blender Z rotation applied before export; OBJs are imported with
# forward=-Y/up=Z so a model natively facing -Y needs 0, +Y needs 180.
JOBS = [
    ('hatchback', 'gz-hatchback', 'OBJ', 0.0254, 180),
    ('suv', 'gz-suv', 'OBJ', 0.06, 0),
    ('prius_hybrid', 'gz-prius', 'OBJ', 0.01, 180),
    ('ambulance', 'gz-ambulance', 'OBJ', 0.0254, 180),
    ('bus', 'gz-bus', 'OBJ', 0.01, 180),
    ('fire_truck', 'gz-firetruck', 'OBJ', 0.1, 0),
    (os.path.abspath('build/gz/_tmp/pickup.obj'), 'gz-pickup', 'OBJABS', 0.0254, 0),

    ('hatchback_red', 'gz-hatchback-red', 'OBJ', 0.0254, 180),
]

def patch_mtl(folder, obj_path, tmp_obj):
    """Copy OBJ to tmp, rewrite its MTL with absolute texture paths."""
    base = os.path.basename(obj_path)
    mtl_ref = None
    with open(obj_path, 'r', errors='ignore') as f:
        obj_text = f.read()
    m = re.search(r'^mtllib\s+(.+)$', obj_text, re.M)
    mtl_path = os.path.join(os.path.dirname(obj_path), m.group(1).strip()) if m else None
    if mtl_path and os.path.exists(mtl_path):
        with open(mtl_path, 'r', errors='ignore') as f:
            mtl = f.read()
        def fix(m2):
            tex = os.path.basename(m2.group(2))
            cand = os.path.join(SRC, folder, 'materials', 'textures', tex)
            if os.path.exists(cand):
                return m2.group(1) + cand
            return m2.group(0)
        mtl = re.sub(r'(map_K[ad]\s+)(\S+)', fix, mtl)
        tmp_mtl = os.path.join(TMP, base.rsplit('.', 1)[0] + '.mtl')
        with open(tmp_mtl, 'w') as f:
            f.write(mtl)
        obj_text = re.sub(r'^mtllib\s+.+$', 'mtllib ' + os.path.basename(tmp_mtl), obj_text, flags=re.M)
    with open(tmp_obj, 'w') as f:
        f.write(obj_text)

def import_model(folder, fmt, scale):
    if fmt == 'OBJABS':
        obj_path = folder
        bpy.ops.wm.obj_import(filepath=obj_path, forward_axis='NEGATIVE_Y', up_axis='Z', global_scale=scale)
        return
    meshes = os.path.join(SRC, folder, 'meshes')
    if fmt == 'OBJ':
        objs = [f for f in os.listdir(meshes) if f.endswith('.obj')]
        obj_path = os.path.join(meshes, objs[0])
        tmp_obj = os.path.join(TMP, folder + '.obj')
        patch_mtl(folder, obj_path, tmp_obj)
        bpy.ops.wm.obj_import(filepath=tmp_obj, forward_axis='NEGATIVE_Y', up_axis='Z', global_scale=scale)
    else:
        daes = [f for f in os.listdir(meshes) if f.endswith('.dae')]
        bpy.ops.wm.collada_import(filepath=os.path.join(meshes, daes[0]))
        for o in bpy.context.scene.objects:
            o.scale = (o.scale[0] * scale, o.scale[1] * scale, o.scale[2] * scale)

for folder, name, fmt, scale, yaw in JOBS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        import_model(folder, fmt, scale)
    except Exception as e:
        print('FAIL_IMPORT', folder, repr(e))
        continue
    objs = [o for o in bpy.context.scene.objects]
    # parent everything to a pivot empty that carries the yaw
    pivot = bpy.data.objects.new('pivot', None)
    bpy.context.scene.collection.objects.link(pivot)
    for o in objs:
        if o.parent is None and o != pivot:
            o.parent = pivot
    pivot.rotation_euler = (0, 0, math.radians(yaw))
    bpy.context.view_layer.update()
    out = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True,
                              export_cameras=False, export_lights=False, export_extras=False)
    print('WROTE', out, 'objs:', len(objs))
print('DONE')
