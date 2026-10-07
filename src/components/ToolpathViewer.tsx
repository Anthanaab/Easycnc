import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useCamStore } from '../cam/camStore'
import type { StockSettings } from '../cam/types'
import type { Toolpath } from '../gcode/parser'
import { useStore } from '../state/store'
import { buildBedGrid, disposeBedGrid } from './bedGrid'

interface SceneRefs {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  cut: THREE.LineSegments
  rapid: THREE.LineSegments
  tool: THREE.Mesh
  stock: THREE.Group
  bedGrid: THREE.Group
  center: THREE.Vector3
}

export function ToolpathViewer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const refs = useRef<SceneRefs | null>(null)
  const toolpath = useStore((s) => s.toolpath)
  const status = useStore((s) => s.status)
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
    scene.add(new THREE.AxesHelper(30))

    const cut = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x35d0ba }),
    )
    const rapid = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xe0803c, transparent: true, opacity: 0.55 }),
    )
    scene.add(cut, rapid)

    const tool = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff4d4d }),
    )
    tool.visible = false
    scene.add(tool)

    const stock = new THREE.Group()
    scene.add(stock)

    refs.current = {
      renderer,
      scene,
      camera,
      controls,
      cut,
      rapid,
      tool,
      stock,
      bedGrid: grid,
      center: new THREE.Vector3(),
    }

    let raf = 0
    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(animate)
    }
    animate()

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
      cut.geometry.dispose()
      rapid.geometry.dispose()
      ;(cut.material as THREE.Material).dispose()
      ;(rapid.material as THREE.Material).dispose()
      tool.geometry.dispose()
      ;(tool.material as THREE.Material).dispose()
      disposeGroup(stock)
      disposeBedGrid(grid)
      renderer.dispose()
      container.removeChild(renderer.domElement)
      refs.current = null
    }
  }, [])

  useEffect(() => {
    const current = refs.current
    if (!current) return
    applyToolpath(current, toolpath)
  }, [toolpath])

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
  }, [machine, stockSetting])

  useEffect(() => {
    const current = refs.current
    if (!current) return
    const position = status?.mpos ?? status?.wpos
    if (!position) {
      current.tool.visible = false
      return
    }
    current.tool.visible = true
    current.tool.position.set(position.x, position.y, position.z)
  }, [status])

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
  const cutPositions: number[] = []
  const rapidPositions: number[] = []

  if (toolpath) {
    for (const segment of toolpath.segments) {
      const target = segment.rapid ? rapidPositions : cutPositions
      target.push(segment.from.x, segment.from.y, segment.from.z, segment.to.x, segment.to.y, segment.to.z)
    }
  }

  setPositions(refs.cut, cutPositions)
  setPositions(refs.rapid, rapidPositions)

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

function setPositions(object: THREE.LineSegments, positions: number[]): void {
  const geometry = object.geometry as THREE.BufferGeometry
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
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
