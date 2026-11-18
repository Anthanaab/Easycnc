import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useCamStore } from '../cam/camStore'
import type { StockSettings } from '../cam/types'
import type { Toolpath } from '../gcode/parser'
import { useStore } from '../state/store'
import { buildBedGrid, disposeBedGrid } from './bedGrid'
import { RenderLoop } from './renderLoop'

interface SceneRefs {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  cut: THREE.LineSegments
  rapid: THREE.LineSegments
  /** Parcours deja execute (pendant un programme). */
  done: THREE.LineSegments
  /** Index de ligne de programme de chaque segment de `done`, croissant. */
  doneLines: Int32Array
  tool: THREE.Mesh
  stock: THREE.Group
  bedGrid: THREE.Group
  center: THREE.Vector3
  loop: RenderLoop
}

export function ToolpathViewer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const refs = useRef<SceneRefs | null>(null)
  const toolpath = useStore((s) => s.toolpath)
  const streamState = useStore((s) => s.stream.state)
  // Ligne du fichier atteinte : via la table de correspondance (essai a blanc,
  // reprise), sinon simple decalage.
  const executedLine = useStore((s) => {
    const done = s.stream.done ?? 0
    const map = s.stream.lineMap
    if (map && map.length) return done >= map.length ? map[map.length - 1] + 1 : map[done]
    return done + (s.stream.lineOffset ?? 0)
  })
  const status = useStore((s) => s.status)
  const offsets = useStore((s) => s.offsets)
  const stockSetting = useCamStore((s) => s.stock)
  const machine = useStore((s) => s.machines.find((m) => m.id === s.machineId))

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x11151c)

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100000)
    camera.up.set(0, 0, 1)
    camera.position.set(150, -150, 150)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.1

    const grid = buildBedGrid(machine?.area.x ?? 300, machine?.area.y ?? 180)
    scene.add(grid)
    // Repere d'origine de travail (X0 Y0 Z0) : axes + etiquettes toujours lisibles.
    scene.add(new THREE.AxesHelper(30))
    const labels = new THREE.Group()
    labels.add(textSprite('X', '#ff5a5a', [36, 0, 0]))
    labels.add(textSprite('Y', '#5aff7a', [0, 36, 0]))
    labels.add(textSprite('Z', '#5a9cff', [0, 0, 36]))
    labels.add(textSprite('X0 Y0', '#e6edf3', [-7, -7, 0], 0.7))
    scene.add(labels)

    const cut = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x35d0ba }),
    )
    const rapid = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xe0803c, transparent: true, opacity: 0.55 }),
    )
    const done = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffe066 }),
    )
    done.visible = false
    done.renderOrder = 1
    scene.add(cut, rapid, done)

    const tool = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff4d4d }),
    )
    tool.visible = false
    scene.add(tool)

    const stock = new THREE.Group()
    scene.add(stock)

    // Rendu a la demande : seulement si la camera bouge ou si les donnees changent.
    const loop = new RenderLoop(() => {
      const moving = controls.update()
      renderer.render(scene, camera)
      return moving
    })
    controls.addEventListener('change', () => loop.invalidate())

    refs.current = {
      loop,
      renderer,
      scene,
      camera,
      controls,
      cut,
      rapid,
      done,
      doneLines: new Int32Array(0),
      tool,
      stock,
      bedGrid: grid,
      center: new THREE.Vector3(),
    }

    loop.invalidate()

    const resize = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      if (!width || !height) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
      loop.invalidate()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    return () => {
      loop.dispose()
      observer.disconnect()
      controls.dispose()
      cut.geometry.dispose()
      rapid.geometry.dispose()
      done.geometry.dispose()
      ;(done.material as THREE.Material).dispose()
      ;(cut.material as THREE.Material).dispose()
      ;(rapid.material as THREE.Material).dispose()
      tool.geometry.dispose()
      ;(tool.material as THREE.Material).dispose()
      disposeGroup(stock)
      disposeBedGrid(grid)
      labels.traverse((object) => {
        const sprite = object as THREE.Sprite
        if (sprite.isSprite) {
          sprite.material.map?.dispose()
          sprite.material.dispose()
        }
      })
      renderer.dispose()
      container.removeChild(renderer.domElement)
      refs.current = null
    }
  }, [])

  useEffect(() => {
    const current = refs.current
    if (!current) return
    applyToolpath(current, toolpath)
    current.loop.invalidate()
  }, [toolpath])

  // Avancement : les segments des lignes deja acquittees par GRBL sont surlignes.
  useEffect(() => {
    const current = refs.current
    if (!current) return
    const active = streamState !== 'idle'
    const count = active ? countBefore(current.doneLines, executedLine) : 0
    const visible = count > 0
    const geometry = current.done.geometry as THREE.BufferGeometry
    if (visible !== current.done.visible || geometry.drawRange.count !== count * 2) {
      current.done.visible = visible
      geometry.setDrawRange(0, count * 2)
      current.loop.invalidate()
    }
  }, [streamState, executedLine, toolpath])

  useEffect(() => {
    const current = refs.current
    if (!current) return
    updateStock(current.stock, stockSetting)
    current.bedGrid.position.z = stockSetting.enabled ? -stockSetting.thickness : 0
    if (!toolpath && stockSetting.enabled) {
      const center = new THREE.Vector3(stockSetting.x, stockSetting.y, -stockSetting.thickness / 2)
      current.controls.target.copy(center)
      const span = Math.max(stockSetting.width, stockSetting.height, stockSetting.thickness, 10)
      const distance = span * 1.8
      current.camera.position.set(center.x + distance * 0.6, center.y - distance, center.z + distance * 0.8)
      current.camera.near = Math.max(0.5, distance / 200)
      current.camera.far = distance * 8
      current.camera.updateProjectionMatrix()
      current.controls.update()
    }
    current.loop.invalidate()
  }, [stockSetting, toolpath])

  useEffect(() => {
    const current = refs.current
    if (!current || !machine) return
    current.scene.remove(current.bedGrid)
    disposeBedGrid(current.bedGrid)
    const grid = buildBedGrid(machine.area.x, machine.area.y)
    grid.position.z = stockSetting.enabled ? -stockSetting.thickness : 0
    current.scene.add(grid)
    current.bedGrid = grid
    current.loop.invalidate()
  }, [machine, stockSetting])

  useEffect(() => {
    const current = refs.current
    if (!current) return
    const mpos = status?.mpos
    const wco = status?.wco ?? offsets.G54
    const position =
      status?.wpos ??
      (mpos && wco ? { x: mpos.x - wco.x, y: mpos.y - wco.y, z: mpos.z - wco.z } : mpos)
    if (!position) {
      if (current.tool.visible) current.loop.invalidate()
      current.tool.visible = false
      return
    }
    const moved = !current.tool.visible || current.tool.position.x !== position.x || current.tool.position.y !== position.y || current.tool.position.z !== position.z
    current.tool.visible = true
    current.tool.position.set(position.x, position.y, position.z)
    if (moved) current.loop.invalidate()
  }, [status, offsets])

  const bounds = toolpath?.bounds
  const size = bounds
    ? {
        x: bounds.max.x - bounds.min.x,
        y: bounds.max.y - bounds.min.y,
        z: bounds.max.z - bounds.min.z,
      }
    : null

  return (
    <div className="viewer">
      <div ref={containerRef} className="viewer-canvas" />
      {size && (
        <div className="viewer-overlay">
          <span>
            X {size.x.toFixed(1)} · Y {size.y.toFixed(1)} · Z {size.z.toFixed(1)} mm
          </span>
          <span>{toolpath?.segments.length ?? 0} segments</span>
        </div>
      )}
    </div>
  )
}

function applyToolpath(refs: SceneRefs, toolpath: Toolpath | null): void {
  const segments = toolpath?.segments ?? []
  // Tableaux types pre-alloues (gros fichiers : centaines de milliers de segments).
  let rapidCount = 0
  for (const segment of segments) if (segment.rapid) rapidCount++
  const cutPositions = new Float32Array((segments.length - rapidCount) * 6)
  const rapidPositions = new Float32Array(rapidCount * 6)
  const donePositions = new Float32Array(segments.length * 6)
  const doneLines = new Int32Array(segments.length)
  let ci = 0
  let ri = 0

  segments.forEach((segment, i) => {
    const { from, to } = segment
    let target = cutPositions
    let offset = ci
    if (segment.rapid) {
      target = rapidPositions
      offset = ri
      ri += 6
    } else {
      ci += 6
    }
    target[offset] = from.x
    target[offset + 1] = from.y
    target[offset + 2] = from.z
    target[offset + 3] = to.x
    target[offset + 4] = to.y
    target[offset + 5] = to.z
    donePositions.set(target.subarray(offset, offset + 6), i * 6)
    // Monotone pour la recherche dichotomique.
    doneLines[i] = Math.max(segment.line ?? 0, i ? doneLines[i - 1] : 0)
  })

  setPositions(refs.cut, cutPositions)
  setPositions(refs.rapid, rapidPositions)
  const doneGeometry = refs.done.geometry as THREE.BufferGeometry
  doneGeometry.setAttribute('position', new THREE.BufferAttribute(donePositions, 3))
  doneGeometry.setDrawRange(0, 0)
  doneGeometry.computeBoundingSphere()
  refs.done.visible = false
  refs.doneLines = doneLines

  if (!toolpath) {
    refs.tool.visible = false
    return
  }

  const { min, max } = toolpath.bounds
  refs.center.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2)
  refs.controls.target.copy(refs.center)

  const span = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 10)
  const distance = span * 1.8
  refs.camera.position.set(refs.center.x + distance * 0.6, refs.center.y - distance, refs.center.z + distance * 0.8)
  refs.camera.near = Math.max(0.5, distance / 200)
  refs.camera.far = distance * 8
  refs.camera.updateProjectionMatrix()
  refs.controls.update()
}

/** Nombre de segments dont la ligne est strictement inferieure a `line`. */
function countBefore(lines: Int32Array, line: number): number {
  let lo = 0
  let hi = lines.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid] < line) lo = mid + 1
    else hi = mid
  }
  return lo
}

function setPositions(object: THREE.LineSegments, positions: Float32Array): void {
  const geometry = object.geometry as THREE.BufferGeometry
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setDrawRange(0, positions.length / 3)
  geometry.computeBoundingSphere()
  object.visible = positions.length > 0
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material
    if (Array.isArray(material)) material.forEach((m) => m.dispose())
    else material?.dispose()
  })
  group.clear()
}

function updateStock(group: THREE.Group, stock: StockSettings): void {
  disposeGroup(group)
  if (!stock.enabled) return
  const geometry = new THREE.BoxGeometry(stock.width, stock.height, stock.thickness)
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0xd8b98a, transparent: true, opacity: 0.12, depthWrite: false }),
  )
  mesh.position.set(stock.x, stock.y, -stock.thickness / 2)
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0xc8a878, transparent: true, opacity: 0.8 }),
  )
  edges.position.copy(mesh.position)
  group.add(mesh, edges)
}

/** Etiquette texte (sprite) toujours face a la camera et au premier plan. */
function textSprite(text: string, color: string, position: [number, number, number], scale = 1): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.font = 'bold 40px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    ctx.fillText(text, 64, 32)
  }
  const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.position.set(...position)
  sprite.scale.set(16 * scale, 8 * scale, 1)
  sprite.renderOrder = 2
  return sprite
}
