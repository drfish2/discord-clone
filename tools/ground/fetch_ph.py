import json, sys, os, subprocess
kind, out = sys.argv[1], sys.argv[2]
def get(u, f):
    subprocess.run(['curl', '-sL', '-m', '120', '-A', 'Mozilla/5.0', '-o', f, u], check=True)
for a in sys.argv[3:]:
    get(f'https://api.polyhaven.com/files/{a}', 'tmp.json')
    d = json.load(open('tmp.json', encoding='utf8'))
    if kind == 'model':
        g = d['gltf']['1k']['gltf']
        os.makedirs(f'{out}/{a}/textures', exist_ok=True)
        get(g['url'], f'{out}/{a}/{a}.gltf')
        for k, v in g['include'].items():
            get(v['url'], f'{out}/{a}/{k}')
    else:
        get(d['Diffuse']['1k']['jpg']['url'], f'{out}/{a}.jpg')
    print('ok', a)
