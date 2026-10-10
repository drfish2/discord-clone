# Blender: import Poly Haven glTF, decimate, drop normal/ARM maps, shrink textures, export plain GLB.
import bpy, sys, os
args = sys.argv[sys.argv.index('--')+1:]
src, out = args[0], args[1]
TARGET = {'fern_02': 1300, 'shrub_sorrel_01': 1100, 'rock_07': 320, 'dry_branches_medium_01': 700, 'shrub_03': 1600, 'weed_plant_02': 1400}
TEX = {'rock_07': 256}
for a, target in TARGET.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f'{src}/{a}/{a}.gltf')
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    ratio = min(1.0, target / tris)
    for o in meshes:
        if ratio < 1:
            m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = ratio
            m.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier='dec')
    for mat in bpy.data.materials:
        if not mat.use_nodes: continue
        nt = mat.node_tree
        for n in nt.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                for inp in ('Normal', 'Metallic', 'Roughness'):
                    for l in list(n.inputs[inp].links): nt.links.remove(l)
                n.inputs['Roughness'].default_value = 0.9
                n.inputs['Metallic'].default_value = 0.0
    for img in bpy.data.images:
        if img.size[0] > 0:
            s = TEX.get(a, 512)
            if img.size[0] > s: img.scale(s, s * img.size[1] // img.size[0])
    tris2 = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    bpy.ops.export_scene.gltf(filepath=f'{out}/ph_{a}.glb', export_format='GLB', export_draco_mesh_compression_enable=False,
                              export_image_format='AUTO', export_materials='EXPORT', export_yup=True, export_unused_images=False)
    print('DONE', a, tris, '->', tris2, [o.name for o in meshes])
