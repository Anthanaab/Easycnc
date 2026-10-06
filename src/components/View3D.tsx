import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildHeightMap, buildSamples, carveTool, stockFromBounds, type HeightMap, type Sample, type ToolKind, type ToolShape } from '../cam/simulation'
import type { CamResult } from '../cam/toolpath'
import type { Bounds } from '../cam/types'
import { buildBedGrid, disposeBedGrid } from './bedGrid'

interface Props {
  result: CamResult | null
  toolDiameter: number
  toolType?: ToolKind
  toolAngle?: number
  safeZ: number
  thickness: number
  resolution: number
  margin: number
  playing: boolean
  speed: number
  resetToken: number
  onProgress: (progress: number) => void
  stockBounds?: Bounds | null
  toolShapes?: Record<string, ToolShape>
  bedArea?: { x: number; y: number }
}

interface SceneRefs {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  surface: THREE.Mesh
  body: THREE.Mesh
  bed: THREE.Group
  stockEdges: THREE.LineSegments
  toolpath: THREE.LineSegments
  tool: THREE.Group
}

interface SimState {
  map: HeightMap
  samples: Sample[]
  index: number
  tool: ToolShape
  tools: Record<string, ToolShape>
  playing: boolean
  speed: number
  dirty: boolean
  lastProgress: number
  lastUpdate: number
  lastNormals: number
}

export function View3D(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const refs = useRef<SceneRefs | null>(null)
  const sim = useRef<SimState | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  const stock = useMemo(
    () => props.stockBounds ?? stockFromBounds(props.result?.bounds ?? null, props.margin),
    // Dépendances primitives : évite de recalculer à chaque rendu (sinon la
    // caméra se recadre et la simulation se réinitialise en boucle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      props.stockBounds?.min.x,
      props.stockBounds?.min.y,
      props.stockBounds?.max.x,
      props.stockBounds?.max.y,
      props.result,
      props.margin,
    ],
  )
  const map = useMemo(
    () => buildHeightMap(stock, props.thickness, props.resolution),
    [stock, props.thickness, props.resolution],
  )
  const samples = useMemo(
    () => (props.result ? buildSamples(props.result, props.safeZ, Math.max(0.5, props.resolution / 2)) : []),
    [props.result, props.safeZ, props.resolution],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0b0e13)
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100000)
    camera.up.set(0, 0, 1)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    scene.add(new THREE.AmbientLight(0xffffff, 0.8))
    const dir = new THREE.DirectionalLight(0xffffff, 1.1)
    dir.position.set(1, -1.4, 2)
    scene.add(dir)
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.4)
    dir2.position.set(-1, 1, 0.6)
    scene.add(dir2)

    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1, 1, 1),
      new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, metalness: 0.05, roughness: 0.85 }),
    )
    scene.add(surface)

    const bodySide = new THREE.MeshStandardMaterial({ color: 0x8a6d47, roughness: 0.95, metalness: 0.02 })
    const bodyTop = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [bodySide, bodySide, bodySide, bodySide, bodyTop, bodySide])
    scene.add(body)

    const bed = new THREE.Group()
    scene.add(bed)

    const stockEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x4c8dff, transparent: true, opacity: 0.45 }),
    )
    scene.add(stockEdges)
    const toolpath = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.95 }),
    )
    scene.add(toolpath)
    const tool = new THREE.Group()
    tool.visible = false
    scene.add(tool)

    refs.current = { renderer, scene, camera, controls, surface, body, bed, stockEdges, toolpath, tool }

    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      stepSimulation(dt)
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    const resize = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      if (!width || !height) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      controls.dispose()
      surface.geometry.dispose()
      ;(surface.material as THREE.Material).dispose()
      body.geometry.dispose()
      const bodyMats = body.material as THREE.Material[]
      bodyMats.forEach((m) => m.dispose())
      disposeBedGrid(bed)
      stockEdges.geometry.dispose()
      ;(stockEdges.material as THREE.Material).dispose()
      toolpath.geometry.dispose()
      ;(toolpath.material as THREE.Material).dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
      refs.current = null
      sim.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const current = refs.current
    if (!current) return
    rebuildScene(current, map, props.toolDiameter, props.toolType ?? 'flat', props.toolAngle ?? 90)
    setToolpath(current, props.result)
    map.heights.fill(0)
    const half = ((props.toolAngle ?? 90) / 2) * (Math.PI / 180)
    sim.current = {
      map,
      samples,
      index: 0,
      tool: {
        kind: props.toolType ?? 'flat',
        radius: Math.max(props.toolDiameter, 0.1) / 2,
        tanHalf: props.toolType === 'vbit' ? Math.tan(half) || 1 : undefined,
      },
      tools: props.toolShapes ?? {},
      playing: propsRef.current.playing,
      speed: propsRef.current.speed,
      dirty: true,
      lastProgress: 0,
      lastUpdate: 0,
      lastNormals: 0,
    }
    fitCamera(current, stock, props.thickness)
    updateSurface(current, sim.current, true)
    propsRef.current.onProgress(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, samples, props.toolDiameter, props.toolType, props.toolAngle, props.toolShapes, props.result, stock, props.thickness])

  useEffect(() => {
    if (sim.current) sim.current.playing = props.playing
  }, [props.playing])

  useEffect(() => {
    const current = refs.current
    if (!current || !props.bedArea) return
    disposeBedGrid(current.bed)
    const grid = buildBedGrid(props.bedArea.x, props.bedArea.y)
    current.bed.add(grid)
    current.bed.position.z = -props.thickness
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bedArea, props.thickness])

  useEffect(() => {
    if (sim.current) sim.current.speed = props.speed
  }, [props.speed])

  useEffect(() => {
    const current = refs.current
    const state = sim.current
    if (!current || !state) return
    state.map.heights.fill(0)
    state.index = 0
    state.lastProgress = 0
    current.tool.visible = false
    current.tool.position.set(0, 0, propsRef.current.safeZ)
    updateSurface(current, state, true)
    propsRef.current.onProgress(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.resetToken])

  function stepSimulation(dt: number): void {
    const current = refs.current
    const state = sim.current
    if (!current || !state) return
    const now = performance.now()
    if (state.playing && state.samples.length && state.index < state.samples.length) {
      const advance = Math.max(1, Math.round(state.speed * state.samples.length * dt))
      const end = Math.min(state.samples.length, state.index + advance)
      for (let i = state.index; i < end; i++) {
        const sample = state.samples[i]
        if (sample.cut) {
          const tool = (sample.toolId && state.tools[sample.toolId]) || state.tool
          carveTool(state.map, sample.x, sample.y, sample.z, tool)
        }
      }
      const lastSample = state.samples[end - 1]
      if (lastSample) {
        current.tool.visible = true
        current.tool.position.set(lastSample.x, lastSample.y, lastSample.z)
      }
      state.index = end
      state.dirty = true
      const progress = state.samples.length ? state.index / state.samples.length : 0
      if (Math.abs(progress - state.lastProgress) >= 0.01 || state.index >= state.samples.length) {
        state.lastProgress = progress
        propsRef.current.onProgress(progress)
      }
    }
    // Mise à jour géométrie limitée (~25 im/s) et normales encore moins souvent.
    if (state.dirty && now - state.lastUpdate > 40) {
      const recompute = now - state.lastNormals > 150
      updateSurface(current, state, recompute)
      if (recompute) state.lastNormals = now
      state.lastUpdate = now
      if (!state.playing) state.dirty = false
    }
  }

  return <div className="view3d" ref={containerRef} />
}

function rebuildScene(current: SceneRefs, map: HeightMap, toolDiameter: number, toolType: ToolKind, toolAngle: number): void {
  const oldGeo = current.surface.geometry
  current.surface.geometry = new THREE.PlaneGeometry(map.width, map.height, map.gx - 1, map.gy - 1)
  oldGeo.dispose()
  const colors = new Float32Array(map.gx * map.gy * 3)
  current.surface.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  current.surface.position.set(map.x0 + map.width / 2, map.y0 + map.height / 2, 0)

  const boxGeo = new THREE.BoxGeometry(map.width, map.height, map.thickness)
  current.stockEdges.geometry.dispose()
  current.stockEdges.geometry = new THREE.EdgesGeometry(boxGeo)
  boxGeo.dispose()
  current.stockEdges.position.set(map.x0 + map.width / 2, map.y0 + map.height / 2, -map.thickness / 2)

  const bodyGeo = new THREE.BoxGeometry(map.width, map.height, map.thickness)
  current.body.geometry.dispose()
  current.body.geometry = bodyGeo
  current.body.position.set(map.x0 + map.width / 2, map.y0 + map.height / 2, -map.thickness / 2)

  const radius = Math.max(toolDiameter, 0.1) / 2
  const metal = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, metalness: 0.6, roughness: 0.3 })
  const red = new THREE.MeshStandardMaterial({ color: 0xff4d4d, metalness: 0.2, roughness: 0.5 })
  current.tool.clear()
  if (toolType === 'vbit') {
    const h = 9
    const topR = Math.max(0.2, h * Math.tan((toolAngle / 2) * (Math.PI / 180)))
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(topR, 0.02, h, 24), red)
    cone.rotation.x = Math.PI / 2
    cone.position.set(0, 0, h / 2)
    current.tool.add(cone)
  } else if (toolType === 'ball') {
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 14, 20), metal)
    shank.rotation.x = Math.PI / 2
    shank.position.set(0, 0, radius + 7)
    const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), red)
    ball.position.set(0, 0, radius)
    current.tool.add(shank, ball)
  } else {
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 14, 20), metal)
    shank.rotation.x = Math.PI / 2
    shank.position.set(0, 0, 7)
    current.tool.add(shank)
  }
}

function setToolpath(current: SceneRefs, result: CamResult | null): void {
  const positions: number[] = []
  const lift = 0.05
  if (result) {
    for (const path of result.paths) {
      const pts = path.closed && path.points.length > 1 ? [...path.points, path.points[0]] : path.points
      for (let i = 1; i < pts.length; i++) {
        const za = (pts[i - 1].z ?? path.z) + lift
        const zb = (pts[i].z ?? path.z) + lift
        positions.push(pts[i - 1].x, pts[i - 1].y, za, pts[i].x, pts[i].y, zb)
      }
    }
  }
  current.toolpath.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  current.toolpath.geometry.computeBoundingSphere()
  current.toolpath.visible = positions.length > 0
}

function updateSurface(current: SceneRefs, state: SimState, recomputeNormals: boolean): void {
  const geometry = current.surface.geometry as THREE.PlaneGeometry
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const color = geometry.getAttribute('color') as THREE.BufferAttribute
  const pos = position.array as Float32Array
  const col = color.array as Float32Array
  const map = state.map
  const heights = map.heights
  const gx = map.gx
  const gy = map.gy
  const invThickness = 1 / Math.max(map.thickness, 0.1)

  // PlaneGeometry : lignes de iy=0 (haut) à iy=gy-1 (bas) ; la heightmap va du
  // bas (y0) vers le haut, d'où la ligne inversée (gy-1-iy).
  for (let iy = 0; iy < gy; iy++) {
    const mapRow = (gy - 1 - iy) * gx
    const base = iy * gx
    for (let ix = 0; ix < gx; ix++) {
      const h = heights[mapRow + ix]
      const vi = base + ix
      pos[vi * 3 + 2] = h
      const shade = 0.75 + 0.25 * Math.max(0, Math.min(1, 1 + h * invThickness))
      col[vi * 3] = 0.85 * shade
      col[vi * 3 + 1] = 0.73 * shade
      col[vi * 3 + 2] = 0.54 * shade
    }
  }
  position.needsUpdate = true
  color.needsUpdate = true
  if (recomputeNormals) geometry.computeVertexNormals()
}

function fitCamera(
  current: SceneRefs,
  stock: { min: { x: number; y: number }; max: { x: number; y: number } },
  thickness: number,
): void {
  const width = stock.max.x - stock.min.x
  const height = stock.max.y - stock.min.y
  const center = new THREE.Vector3((stock.min.x + stock.max.x) / 2, (stock.min.y + stock.max.y) / 2, -thickness / 2)
  current.controls.target.copy(center)
  const span = Math.max(width, height, thickness, 20)
  const distance = span * 1.9
  current.camera.position.set(center.x + distance * 0.6, center.y - distance * 0.9, center.z + distance * 0.7)
  current.camera.near = Math.max(0.5, distance / 200)
  current.camera.far = distance * 8
  current.camera.updateProjectionMatrix()
  current.controls.update()
}
