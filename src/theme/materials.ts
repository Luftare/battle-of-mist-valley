import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

const materialCache = new Map<string, StandardMaterial>();

export function colorMat(
  scene: Scene,
  name: string,
  hex: string,
  opts?: { specular?: number; emissive?: number },
): StandardMaterial {
  const key = `${name}|${hex}|${opts?.specular ?? 0.15}|${opts?.emissive ?? 0}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor = Color3.FromHexString(hex).scale(opts?.specular ?? 0.15);
  if (opts?.emissive) {
    mat.emissiveColor = Color3.FromHexString(hex).scale(opts.emissive);
  }
  materialCache.set(key, mat);
  return mat;
}

/** Drop cached mats whose name starts with `prefix` (e.g. after disposing a bake scene). */
export function purgeMaterialCache(prefix: string): void {
  for (const key of [...materialCache.keys()]) {
    if (key.startsWith(prefix)) materialCache.delete(key);
  }
}

/** Clear all cached materials (e.g. after disposing a temporary scene). */
export function clearMaterialCache(): void {
  materialCache.clear();
}

export function box(
  scene: Scene,
  name: string,
  size: { w: number; h: number; d: number },
  position: Vector3,
  material: StandardMaterial,
  parent?: TransformNode | Mesh,
): Mesh {
  const mesh = MeshBuilder.CreateBox(
    name,
    { width: size.w, height: size.h, depth: size.d },
    scene,
  );
  mesh.position = position.clone();
  mesh.material = material;
  mesh.isPickable = false;
  if (parent) mesh.parent = parent;
  return mesh;
}

export function cylinder(
  scene: Scene,
  name: string,
  opts: { height: number; diameter: number; tessellation?: number },
  position: Vector3,
  material: StandardMaterial,
  parent?: TransformNode | Mesh,
): Mesh {
  const mesh = MeshBuilder.CreateCylinder(
    name,
    {
      height: opts.height,
      diameter: opts.diameter,
      tessellation: opts.tessellation ?? 6,
    },
    scene,
  );
  mesh.position = position.clone();
  mesh.material = material;
  mesh.isPickable = false;
  if (parent) mesh.parent = parent;
  return mesh;
}
