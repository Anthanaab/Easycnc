import * as THREE from 'three'

/** Grille du plateau dans le repere machine : (0,0) en bas-gauche -> (w,h). */
export function buildBedGrid(width: number, height: number): THREE.Group {
  const group = new THREE.Group()
  const w = Math.max(width, 1)
  const h = Math.max(height, 1)
  const step = w >= 400 || h >= 400 ? 50 : w >= 200 || h >= 200 ? 20 : 10

  const lines: number[] = []
  for (let x = 0; x <= w + 1e-6; x += step) lines.push(x, 0, 0, x, h, 0)
  for (let y = 0; y <= h + 1e-6; y += step) lines.push(0, y, 0, w, y, 0)
  lines.push(w, 0, 0, w, h, 0)
  lines.push(0, h, 0, w, h, 0)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
  group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x2b3542 })))

  const borderGeo = new THREE.BufferGeometry()
  borderGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, w, 0, 0, w, h, 0, 0, h, 0], 3))
  group.add(new THREE.LineLoop(borderGeo, new THREE.LineBasicMaterial({ color: 0x4c8dff, transparent: true, opacity: 0.7 })))

  return group
}

export function disposeBedGrid(group: THREE.Group): void {
  group.traverse((object) => {
    const line = object as THREE.LineSegments
    if (line.geometry) line.geometry.dispose()
    const material = (line as unknown as { material?: THREE.Material | THREE.Material[] }).material
    if (Array.isArray(material)) material.forEach((m) => m.dispose())
    else material?.dispose()
  })
  group.clear()
}
