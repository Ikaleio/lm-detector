import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { type MotionState, type Phase, type SceneResult } from './model'
import { DIM, ease } from './dimensions'
import { ticketTexture } from './textures'

const ROWS = 84, COLS = 12
export function Paper({ phase, motion, result }: { phase: Phase; motion: RefObject<MotionState>; result: SceneResult | null }) {
  const group = useRef<THREE.Group>(null)
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const positions = new Float32Array((ROWS + 1) * (COLS + 1) * 3)
    const uv = new Float32Array((ROWS + 1) * (COLS + 1) * 2)
    const indices: number[] = []
    for (let row = 0; row <= ROWS; row++) for (let col = 0; col <= COLS; col++) {
      const i = row * (COLS + 1) + col
      uv[i * 2] = col / COLS; uv[i * 2 + 1] = 1 - row / ROWS
      if (row < ROWS && col < COLS) { const a = i, b = i + 1, c = i + COLS + 1, d = c + 1; indices.push(a, c, b, b, c, d) }
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setIndex(indices)
    return g
  }, [])
  const texture = useMemo(() => ticketTexture(result?.best.name ?? '', result?.best.id ?? 'neutral', result?.title ?? '', result?.detail ?? ''), [result?.best.name, result?.best.id, result?.title, result?.detail])
  useEffect(() => () => { geometry.dispose() }, [geometry])
  useEffect(() => () => { texture.dispose() }, [texture])
  const last = useRef(-1)
  const phaseStartedAt = useRef(performance.now())
  const previousPhase = useRef<Phase>(motion.current.phase)
  useFrame(() => {
    const activePhase = motion.current.phase
    if (previousPhase.current !== activePhase) {
      previousPhase.current = activePhase
      phaseStartedAt.current = performance.now()
      last.current = -1
    }
    const elapsed = Math.max(0, (performance.now() - phaseStartedAt.current) / 1000)
    const localPrint = activePhase === 'printing' ? THREE.MathUtils.clamp(elapsed / 1.8, 0, 1) : activePhase === 'report' ? 1 : 0
    const print = Math.max(motion.current.print, localPrint)
    if (group.current) group.current.visible = activePhase === 'printing' || activePhase === 'report'
    if (last.current === print) return
    last.current = print
    const feed = ease(Math.min(print / .88, 1))
    const settle = Math.max(0, (print - .8) / .2)
    const swing = Math.sin(settle * Math.PI * 3) * Math.sin(settle * Math.PI) * .025
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute
    for (let row = 0; row <= ROWS; row++) {
      const u = row / ROWS
      // The complete sheet translates through the slot. Negative s stays INSIDE the opaque chassis.
      // The exposed centerline has a horizontal tangent at the rollers and smoothly bends downward.
      const s = DIM.paperLength * (u - (1 - feed))
      const exposed = Math.max(s, 0)
      const y = DIM.slotY - .55 * (exposed - .7 * (1 - Math.exp(-exposed / .7))) + swing * Math.pow(exposed / DIM.paperLength, 2)
      const z = DIM.slotZ + s - .045 * exposed * exposed
      for (let col = 0; col <= COLS; col++) {
        const cross = col / COLS - .5
        pos.setXYZ(row * (COLS + 1) + col, cross * DIM.paperWidth, y - cross * cross * .025 * exposed, z)
      }
    }
    pos.needsUpdate = true
    geometry.computeVertexNormals()
  })
  return <group ref={group} visible={false} name="physically-fed-ticket">
    <mesh geometry={geometry} castShadow receiveShadow frustumCulled={false}>
      <meshStandardMaterial map={texture} roughness={.92} metalness={0} side={THREE.FrontSide} />
    </mesh>
    <mesh geometry={geometry} position={[0, -.003, 0]} castShadow frustumCulled={false}>
      <meshStandardMaterial color="#f6f2e6" roughness={1} side={THREE.BackSide} />
    </mesh>
  </group>
}
