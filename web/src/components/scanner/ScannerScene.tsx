import ThemeLighting from './ThemeLighting'
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { RoundedBox, OrbitControls } from '@react-three/drei'
import { RotateCcw } from 'lucide-react'
import * as THREE from 'three'
import { useI18n } from '@/i18n'
import { useMotionPreset } from '@/lib/motion'
import { type BrandId, type MotionState, type Phase, type SceneResult, resolveBrand } from './model'
import { BOX_CENTER_Y, BOX_TOP_Y, DIM, ease } from './dimensions'
import { kraftTexture, loadBrand, machineLabel, plaqueBaseTexture, plaqueLogoMorphTexture, plaqueLogoTexture, plaqueNameMorphTexture, plaqueNameTexture, topStamp } from './textures'
import { Paper } from './Paper'

type Vec3 = [number, number, number]
const LABEL_SETTLE_DURATION = 1.6
const PLAQUE_CONTENT_TRANSITION_DURATION = .48
const PLAQUE_X = -.10
const PLAQUE_Y = -.01
const PLAQUE_Z = .805
const AUTO_MODELS = [
  { brand: 'deepseek', name: 'DeepSeek' },
  { brand: 'gemini', name: 'Gemini' },
  { brand: 'gpt', name: 'GPT' },
  { brand: 'glm', name: 'GLM' },
  { brand: 'qwen', name: 'Qwen' },
  { brand: 'claude', name: 'Claude' },
  { brand: 'mimo', name: 'MiMo' },
  { brand: 'kimi', name: 'Kimi' },
  { brand: 'hunyuan', name: 'Hy4' },
  { brand: 'grok', name: 'Grok' },
] satisfies Array<{ brand: BrandId; name: string }>
const AUTO_BRANDS = AUTO_MODELS.map(model => model.brand)
const AUTO_NAMES = AUTO_MODELS.map(model => model.name)
/**
 * The machine stands up around the box once the plaque can name a family, and while no name is set yet,
 * so filling the replies or the API settings still drives the clamps, lamps and gantry. A name the plaque
 * cannot place leaves the box alone.
 */
const machineShown = (name: string) => resolveBrand(name) !== 'neutral' || !name.trim()
interface Props { name: string; inputMode: 'manual' | 'api'; baseUrl: string; apiKey: string; filled: [boolean, boolean, boolean]; focus: number | null; phase: Phase; motion: RefObject<MotionState>; result: SceneResult | null }

function Part({ at, size, color = '#51463B', radius = .05, metal = .3, roughness = .5, rotation, children }: { at: Vec3; size: Vec3; color?: string; radius?: number; metal?: number; roughness?: number; rotation?: Vec3; children?: ReactNode }) {
  return <RoundedBox position={at} args={size} radius={radius} smoothness={3} bevelSegments={2} castShadow receiveShadow rotation={rotation}>
    <meshStandardMaterial color={color} roughness={roughness} metalness={metal} />{children}
  </RoundedBox>
}
function Screw({ at, axis = 'front' }: { at: Vec3; axis?: 'front' | 'top' }) {
  return <group position={at} rotation={axis === 'front' ? [Math.PI / 2, 0, 0] : [0, 0, 0]}>
    <mesh castShadow><cylinderGeometry args={[.037, .037, .016, 12]} /><meshStandardMaterial color="#98a69c" metalness={.85} roughness={.34} /></mesh>
    <mesh position={[0, .009, 0]}><boxGeometry args={[.042, .002, .009]} /><meshStandardMaterial color="#28332e" /></mesh>
  </group>
}
function CameraRig({ zoom, reset, phase }: { zoom: number; reset: number; phase: Phase }) {
  const { reduced } = useMotionPreset()
  const { camera, size, gl, invalidate } = useThree()
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const fitZoom = useRef(1)
  const resetBlend = useRef(0)
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera
    fitZoom.current = Math.min(size.width / 6.8, size.height / 5.2)
    cam.zoom = fitZoom.current * zoom
    cam.updateProjectionMatrix()
    gl.domElement.dataset.cameraZoom = cam.zoom.toFixed(4)
    invalidate()
  }, [camera, size.width, size.height, gl, invalidate])
  useEffect(() => {
    resetBlend.current = 1
    invalidate()
  }, [camera, reset, invalidate])
  useEffect(() => {
    const handle = window.setInterval(() => { if (!document.hidden) invalidate() }, 1000 / 30)
    return () => window.clearInterval(handle)
  }, [invalidate])
  useFrame((_, raw) => {
    const cam = camera as THREE.OrthographicCamera
    const dt = Math.min(raw, .05)
    if (resetBlend.current > 0) {
      const target = new THREE.Vector3(5.8, 4.75, 8)
      cam.position.lerp(target, 1 - Math.exp(-10 * dt))
      controls.current?.target.lerp(new THREE.Vector3(0, 1.43, .38), 1 - Math.exp(-10 * dt))
      controls.current?.update()
      resetBlend.current = Math.max(0, resetBlend.current - dt * 1.6)
      invalidate()
    }
    const next = THREE.MathUtils.damp(cam.zoom, fitZoom.current * zoom, 7, Math.min(raw, .05))
    if (Math.abs(cam.zoom - next) > .0001) { cam.zoom = next; cam.updateProjectionMatrix(); invalidate() }
    gl.domElement.dataset.cameraZoom = cam.zoom.toFixed(4)
    gl.domElement.dataset.cameraTargetZoom = (fitZoom.current * zoom).toFixed(4)
  })
  return <OrbitControls ref={controls} makeDefault target={[0, 1.43, .38]} enablePan={false} enableZoom={false} enableDamping dampingFactor={.12} rotateSpeed={.7} autoRotate={phase === 'editing' && !reduced} autoRotateSpeed={.50} minAzimuthAngle={-1.15} maxAzimuthAngle={1.15} minPolarAngle={.35} maxPolarAngle={1.35} onChange={() => {
    gl.domElement.dataset.cameraPosition = camera.position.toArray().join(',')
    invalidate()
  }} />
}

function Scanner({ name, inputMode, baseUrl, apiKey, filled, focus, phase, motion, result }: Props) {
  const invalidate = useThree(s => s.invalidate)
  useEffect(() => { invalidate() }, [phase, inputMode, name, baseUrl, apiKey, filled[0], filled[1], filled[2], focus, result?.best.id, invalidate])
  const count = filled.filter(Boolean).length
  // Automatic evaluation should reveal the scanner only after the model name
  // maps to a known provider, matching the manual mode's prefix recognition.
  const autoModelReady = inputMode === 'api' && resolveBrand(name) !== 'neutral'
  const autoBaseReady = autoModelReady && baseUrl.trim().length > 0
  const autoKeyReady = autoBaseReady && apiKey.trim().length > 0
  const activeStageCount = inputMode === 'manual' ? count : autoKeyReady ? 3 : autoBaseReady ? 2 : autoModelReady ? 1 : 0
  const [cycle, setCycle] = useState(0)
  const [incomingCycle, setIncomingCycle] = useState<number | null>(null)
  const [displayed, setDisplayed] = useState<{ brand: BrandId; name: string }>({ brand: AUTO_BRANDS[0], name: AUTO_NAMES[0] })
  const [declaredTarget, setDeclaredTarget] = useState<{ brand: BrandId; name: string } | null>(null)
  const [morphReady, setMorphReady] = useState(false)
  const hasDeclaredName = name.trim().length > 0
  const resolvedNameBrand = resolveBrand(name)
  const plaqueTransition = useRef<'idle' | 'preparing' | 'active'>('idle')
  const plaqueTransitionProgress = useRef(1)
  useEffect(() => {
    void Promise.allSettled(AUTO_BRANDS.map(loadBrand)).then(() => invalidate())
  }, [invalidate])
  useEffect(() => {
    if (phase === 'editing') return
    setIncomingCycle(null)
    setDeclaredTarget(null)
    setMorphReady(false)
    plaqueTransition.current = 'idle'
    plaqueTransitionProgress.current = 1
    invalidate()
  }, [phase, invalidate])
  useEffect(() => {
    const trimmed = name.trim()
    if (!trimmed) {
      setDeclaredTarget(null)
      if (displayed.brand !== AUTO_BRANDS[cycle] || displayed.name !== AUTO_NAMES[cycle]) setDisplayed({ brand: AUTO_BRANDS[cycle], name: AUTO_NAMES[cycle] })
      return
    }
    if (resolvedNameBrand === 'neutral') {
      setDeclaredTarget(null)
      if (displayed.brand !== 'neutral' || displayed.name !== trimmed) setDisplayed({ brand: 'neutral', name: trimmed })
      return
    }
    if (displayed.brand === resolvedNameBrand && displayed.name === trimmed) return
    if (declaredTarget?.brand === resolvedNameBrand && declaredTarget.name === trimmed) return
    setIncomingCycle(null)
    setDeclaredTarget({ brand: resolvedNameBrand, name: trimmed })
  }, [name, resolvedNameBrand, cycle, displayed, declaredTarget])
  useEffect(() => {
    if (hasDeclaredName || phase !== 'editing') return
    const handle = window.setInterval(() => {
      if (document.hidden || plaqueTransition.current !== 'idle') return
      setIncomingCycle((cycle + 1) % AUTO_BRANDS.length)
    }, 4400)
    return () => window.clearInterval(handle)
  }, [hasDeclaredName, phase, cycle])
  const brand = displayed.brand
  const displayName = hasDeclaredName ? name.trim() : displayed.name
  const incomingBrand = declaredTarget?.brand ?? (incomingCycle === null ? null : AUTO_BRANDS[incomingCycle])
  const incomingName = declaredTarget ? null : (incomingCycle === null ? null : AUTO_NAMES[incomingCycle])
  const hasMachine = machineShown(name)
  const kraft = useMemo(kraftTexture, [])
  const machine = useMemo(machineLabel, [])
  const stamp = useMemo(topStamp, [])
  const plaqueBase = useMemo(plaqueBaseTexture, [])
  const plaqueLogo = useMemo(() => plaqueLogoTexture(brand, invalidate), [brand, invalidate])
  const plaqueName = useMemo(() => plaqueNameTexture(displayName), [displayName])
  const logoMorph = useMemo(() => incomingBrand ? plaqueLogoMorphTexture(brand, incomingBrand, invalidate) : null, [brand, incomingBrand, invalidate])
  const nameMorph = useMemo(() => incomingName ? plaqueNameMorphTexture(displayName, incomingName) : null, [displayName, incomingName])
  useEffect(() => {
    if (incomingBrand === null || !logoMorph) {
      setMorphReady(false)
      plaqueTransition.current = 'idle'
      plaqueTransitionProgress.current = 1
      return
    }
    let active = true
    setMorphReady(false)
    plaqueTransition.current = 'preparing'
    plaqueTransitionProgress.current = 0
    void Promise.all([logoMorph.ready, nameMorph?.ready]).then(() => {
      if (!active) return
      logoMorph.render(0)
      nameMorph?.render(0)
      setMorphReady(true)
      plaqueTransition.current = 'active'
      invalidate()
    })
    return () => { active = false }
  }, [incomingBrand, logoMorph, nameMorph, invalidate])
  useEffect(() => () => { kraft.dispose(); machine.dispose(); stamp.dispose(); plaqueBase.dispose() }, [kraft, machine, stamp, plaqueBase])
  useEffect(() => () => { plaqueLogo.dispose() }, [plaqueLogo])
  useEffect(() => () => { plaqueName.dispose() }, [plaqueName])
  useEffect(() => () => { logoMorph?.dispose() }, [logoMorph])
  useEffect(() => () => { nameMorph?.dispose() }, [nameMorph])
  const gantry = useRef<THREE.Group>(null)
  const machineTop = useRef<THREE.Group>(null)
  const machineBottom = useRef<THREE.Group>(null)
  const box = useRef<THREE.Group>(null)
  const leftClamp = useRef<THREE.Group>(null)
  const rightClamp = useRef<THREE.Group>(null)
  const emitter = useRef<THREE.MeshStandardMaterial>(null)
  const frontEmitter = useRef<THREE.MeshStandardMaterial>(null)
  const scan = useRef<THREE.Group>(null)
  const ledMaterials = useRef<(THREE.MeshStandardMaterial | null)[]>([])
  const roller = useRef<THREE.Group>(null)
  const corner = useRef<THREE.Mesh>(null)
  // Keep this animation on a local monotonic timeline. R3F resets its scene
  // clock when a demand-frameloop canvas is paused/resumed.
  const labelSettleElapsed = useRef(LABEL_SETTLE_DURATION)
  const previousCount = useRef(count)
  const leftClampGap = useRef(.2)
  const rightClampGap = useRef(.2)
  const targetColor = useMemo(() => new THREE.Color('#E9D6B6'), [])
  const offColor = useMemo(() => new THREE.Color('#58645a'), [])
  const labelGeometry = useMemo(() => new THREE.PlaneGeometry(1.56, .72, 20, 10), [])
  useEffect(() => () => labelGeometry.dispose(), [labelGeometry])
  const frame = useRef(0)
  const lastInfo = useRef(0)
  const phaseStartedAt = useRef(performance.now())
  const previousPhase = useRef<Phase>(motion.current.phase)
  useFrame((state, raw) => {
    // Mechanical parts should catch up after a sparse demand-rendered frame;
    // label flutter below keeps its own tighter cap for visual stability.
    const dt = Math.min(raw, .2)
    const live = motion.current
    // The outer React tree and the R3F reconciler advance on different
    // schedules. Read the mutable controller state here so a demand-frame
    // pause cannot leave the mechanical scene one phase behind the form.
    const activePhase = live.phase
    if (previousPhase.current !== activePhase) {
      previousPhase.current = activePhase
      phaseStartedAt.current = performance.now()
    }
    const elapsed = Math.max(0, (performance.now() - phaseStartedAt.current) / 1000)
    const scanProgress = activePhase === 'scanning' ? THREE.MathUtils.clamp(elapsed / 8, 0, 1) : activePhase === 'printing' || activePhase === 'report' ? 1 : 0
    const printProgress = activePhase === 'printing' ? THREE.MathUtils.clamp(elapsed / 1.8, 0, 1) : activePhase === 'report' ? 1 : 0
    const locked = activePhase !== 'editing'
    const activeCount = locked ? 3 : activeStageCount
    let plaqueMoving = plaqueTransition.current === 'active' && morphReady && incomingBrand !== null && logoMorph !== null
    if (plaqueMoving && logoMorph && incomingBrand !== null) {
      const progress = Math.min(1, plaqueTransitionProgress.current + dt / PLAQUE_CONTENT_TRANSITION_DURATION)
      plaqueTransitionProgress.current = progress
      const eased = progress * progress * (3 - 2 * progress)
      logoMorph.render(eased)
      nameMorph?.render(eased)
      if (progress >= 1) {
        const completedCycle = incomingCycle
        const completedTarget = declaredTarget
        plaqueTransition.current = 'idle'
        plaqueTransitionProgress.current = 1
        plaqueMoving = false
        setMorphReady(false)
        if (completedTarget) {
          setDisplayed(completedTarget)
          setDeclaredTarget(null)
        } else if (completedCycle !== null) {
          setCycle(completedCycle)
        }
        setIncomingCycle(null)
      }
    }
    const baseY = THREE.MathUtils.damp(machineTop.current?.position.y ?? -3.8, hasMachine ? 0 : -3.8, hasMachine ? 7 : 12, dt)
    const armY = THREE.MathUtils.damp(machineBottom.current?.position.y ?? 3.8, hasMachine ? 0 : 3.8, hasMachine ? 7 : 12, dt)
    if (machineTop.current) machineTop.current.position.y = baseY
    if (machineBottom.current) machineBottom.current.position.y = armY
    const groundBoxY = DIM.boxHeight / 2 + .023
    const boxTargetY = hasMachine ? BOX_CENTER_Y : groundBoxY
    const boxY = box.current
      ? THREE.MathUtils.damp(box.current.position.y, boxTargetY, hasMachine ? 8 : 14, dt)
      : boxTargetY
    if (previousCount.current !== count) {
      previousCount.current = count
      labelSettleElapsed.current = 0
    }
    const targetX = activeCount > 0 ? 0 : .045
    if (box.current) box.current.position.x = THREE.MathUtils.damp(box.current.position.x, targetX, 6, dt)
    if (box.current) box.current.position.y = boxY
    const leftClampTarget = inputMode === 'api' ? (autoBaseReady ? .013 : .2) : activeCount >= 1 ? .013 : .2
    const rightClampTarget = inputMode === 'api' ? (autoBaseReady ? .013 : .2) : activeCount >= 2 ? .013 : .2
    leftClampGap.current = THREE.MathUtils.damp(leftClampGap.current, leftClampTarget, 9, dt)
    rightClampGap.current = THREE.MathUtils.damp(rightClampGap.current, rightClampTarget, 9, dt)
    const bx = box.current?.position.x ?? 0
    if (leftClamp.current) leftClamp.current.position.x = bx - DIM.boxWidth / 2 - .075 - leftClampGap.current
    if (rightClamp.current) rightClamp.current.position.x = bx + DIM.boxWidth / 2 + .075 + rightClampGap.current
    let railTarget = inputMode === 'api' ? (autoKeyReady ? DIM.gantryBack : 0) : activeCount >= 3 ? DIM.gantryBack : 0
    let sweep = false
    if (activePhase === 'scanning') {
      const t = Math.max(live.scan, scanProgress)
      railTarget = t < .17 ? DIM.gantryBack : t < .77 ? THREE.MathUtils.lerp(DIM.gantryBack, DIM.gantryFront, ease((t - .17) / .60)) : THREE.MathUtils.lerp(DIM.gantryFront, DIM.gantryBack, ease((t - .77) / .23))
      sweep = t >= .17 && t < .77
    }
    if (gantry.current) gantry.current.position.z = THREE.MathUtils.damp(gantry.current.position.z, railTarget, 10, dt)
    const railZ = gantry.current?.position.z ?? railTarget
    const lightTarget = sweep ? 1.8 : inputMode === 'api' ? (autoBaseReady ? .7 : .015) : activeCount >= 2 ? .7 : .015
    if (emitter.current) emitter.current.emissiveIntensity = THREE.MathUtils.damp(emitter.current.emissiveIntensity, lightTarget, 5, dt)
    if (frontEmitter.current) frontEmitter.current.emissiveIntensity = emitter.current?.emissiveIntensity ?? 0
    if (scan.current) {
      scan.current.visible = sweep && Math.abs(railZ - DIM.boxZ) < DIM.boxDepth / 2
      scan.current.position.z = railZ
    }
    ledMaterials.current.forEach((material, i) => {
      if (!material) return
      const on = locked || filled[i]
      material.color.lerp(on ? targetColor : offColor, 1 - Math.exp(-dt * 12))
      material.emissiveIntensity = THREE.MathUtils.damp(material.emissiveIntensity, on ? (focus === i ? 1.6 : .95) : .02, 10, dt)
    })
    const renderedPrint = Math.max(live.print, printProgress)
    if (roller.current) roller.current.rotation.x = -renderedPrint * 15
    const labelDelta = Number.isFinite(raw) ? THREE.MathUtils.clamp(raw, 0, .05) : 0
    labelSettleElapsed.current = Math.min(labelSettleElapsed.current + labelDelta, LABEL_SETTLE_DURATION)
    if (corner.current) {
      const elapsed = labelSettleElapsed.current
      const flutter = elapsed < LABEL_SETTLE_DURATION ? Math.exp(-elapsed * 4) * Math.sin(elapsed * 19) * .018 : 0
      const positions = labelGeometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i)
        const edge = THREE.MathUtils.clamp((x + .1) / .88, 0, 1) * THREE.MathUtils.clamp((y + .02) / .38, 0, 1)
        const z = .006 + edge * (.012 + flutter)
        // Keep the sticker in front of the box even if an input is invalid.
        positions.setZ(i, Number.isFinite(z) ? THREE.MathUtils.clamp(z, .006, .036) : .006)
      }
      positions.needsUpdate = true; labelGeometry.computeVertexNormals()
    }
    frame.current++
    const moving = plaqueMoving || locked && activePhase !== 'report' || Math.abs(bx - targetX) > .0003 || Math.abs(leftClampGap.current - leftClampTarget) > .0003 || Math.abs(rightClampGap.current - rightClampTarget) > .0003 || Math.abs(railZ - railTarget) > .001 || Math.abs((emitter.current?.emissiveIntensity ?? 0) - lightTarget) > .01 || ledMaterials.current.some((m, i) => Math.abs((m?.emissiveIntensity ?? 0) - (locked || filled[i] ? (focus === i ? 1.6 : .95) : .02)) > .01) || (labelSettleElapsed.current < LABEL_SETTLE_DURATION)
    if (moving) state.invalidate()
    if (frame.current === 1 || !moving || state.clock.elapsedTime - lastInfo.current > .12) {
      lastInfo.current = state.clock.elapsedTime
      const s = DIM.paperLength * ease(Math.min(renderedPrint / .88, 1))
    }
  })

  return <group name="FR-01-scanner">
    <group ref={machineTop} visible={hasMachine} position={[0, -3.8, 0]}>
    {/* The chassis has real separated front panels, leaving an actual open paper aperture. */}
    {[-1.78, 1.78].flatMap(x => [-1.08, 1.08].map(z => <group key={`${x}-${z}`}>
      <Part at={[x, .17, z]} size={[.52, .28, .49]} radius={.09} color="#2a332e" roughness={.93} metal={.08} />
      <Part at={[x, .29, z]} size={[.46, .10, .44]} radius={.035} color="#8f9b8e" metal={.7} />
    </group>))}
    <Part at={[0, .72, -.195]} size={[4.6, .84, 2.86]} radius={.14} color="#51463B" />
    <Part at={[0, 1.00, 1.39]} size={[4.6, .29, .47]} radius={.075} color="#51463B" />
    <Part at={[0, .443, 1.40]} size={[4.6, .286, .45]} radius={.09} color="#42382F" />
    {[-1, 1].map(sign => <Part key={sign} at={[sign * 1.87, .71, 1.415]} size={[.86, .46, .42]} radius={.065} color="#51463B" />)}
    <Part at={[0, .72, 1.27]} size={[2.7, .24, .035]} radius={.007} color="#0b130f" roughness={1} metal={0} />
    <Part at={[0, .836, 1.566]} size={[2.62, .045, .24]} radius={.016} color="#839183" metal={.8} roughness={.32} />
    <Part at={[0, .601, 1.66]} size={[2.62, .055, .29]} radius={.02} color="#8c9789" metal={.8} roughness={.3} />
    {[-1, 1].map(sign => <Part key={`guide${sign}`} at={[sign * 1.15, .672, 1.707]} size={[.115, .115, .30]} radius={.025} color="#616f63" metal={.7} />)}
    <group ref={roller} position={[0, .668, 1.59]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[.05, .05, 2.21, 24]} /><meshStandardMaterial color="#aab4a5" roughness={.45} metalness={.7} /></mesh>
      {[-.75, -.26, .26, .75].map(x => <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.055, .055, .19, 20]} /><meshStandardMaterial color="#202b23" roughness={.94} /></mesh>)}
    </group>
    <mesh position={[.73, 1.005, 1.632]}><planeGeometry args={[1.65, .258]} /><meshStandardMaterial map={machine} roughness={.8} /></mesh>
    {filled.map((_, i) => <group key={i} position={[-1.39 + i * .31, 1.014, 1.637]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.075, .075, .015, 24]} /><meshStandardMaterial color="#142b20" metalness={.6} roughness={.45} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, .013]}><cylinderGeometry args={[.043, .046, .019, 24]} /><meshStandardMaterial ref={m => { ledMaterials.current[i] = m }} color="#58645a" emissive="#D9CFC7" emissiveIntensity={.02} roughness={.28} /></mesh>
    </group>)}
    {[-2.06, 2.06].map(x => <Screw key={x} at={[x, .973, 1.645]} />)}
    <Part at={[1.83, .447, 1.633]} size={[.25, .076, .016]} radius={.01} color="#d89058" roughness={.6} metal={.2} />
    {/* Inset tray and rail supports are attached to the body, not floating above it. */}
    <Part at={[0, 1.21, -.14]} size={[DIM.trayWidth, .14, DIM.trayDepth]} color="#202e27" radius={.10} roughness={.85} metal={.15} />
    <Part at={[0, 1.265, -.14]} size={[3.04, .03, 2.14]} color="#56605a" radius={.055} roughness={1} metal={0} />
    {[-1, 1].map(sign => <group key={`rail${sign}`}>
      <Part at={[sign * DIM.railX, 1.19, -.12]} size={[.29, .11, 3.02]} radius={.042} color="#26342b" />
      <mesh position={[sign * DIM.railX, DIM.railY, -.12]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[.044, .044, DIM.railLength, 18]} /><meshStandardMaterial color="#bac4b4" metalness={.87} roughness={.28} /></mesh>
      {[-1.51, 1.27].map(z => <group key={z}><Part at={[sign * DIM.railX, 1.274, z]} size={[.32, .16, .17]} radius={.038} color="#50604f" /><Screw at={[sign * DIM.railX, 1.359, z]} axis="top" /></group>)}
    </group>)}
    {/* Locating pads are constrained outside the box's current side surfaces. */}
    {[-1, 1].map(sign => <group key={`clamp${sign}`} ref={sign === -1 ? leftClamp : rightClamp} position={[sign * 1.44, 0, 0]}>
      <Part at={[0, 1.335, .21]} size={[.14, .11, .60]} radius={.027} color="#a0aa98" metal={.75} />
      <Part at={[-sign * .03, 1.43, .21]} size={[.078, .18, .46]} radius={.022} color="#3f5142" roughness={.95} metal={0} />
    </group>)}
    </group>
    <group ref={box} position={[.045, DIM.boxHeight / 2 + .023, DIM.boxZ]} name="supported-kraft-box">
      <RoundedBox args={[DIM.boxWidth, DIM.boxHeight, DIM.boxDepth]} radius={.035} smoothness={3} bevelSegments={2} castShadow receiveShadow><meshStandardMaterial map={kraft} roughness={.96} metalness={0} /></RoundedBox>
      <Part at={[0, DIM.boxHeight / 2 + .003, 0]} size={[.32, .006, 1.55]} radius={.002} color="#EFE9E3" roughness={.93} metal={0} />
      <Part at={[0, .415, .801]} size={[.32, .34, .005]} radius={.002} color="#EFE9E3" roughness={.93} metal={0} />
      <Part at={[0, .27, -.801]} size={[.32, .62, .005]} radius={.002} color="#D9CFC7" roughness={1} metal={0} />
      <mesh position={[-.70, .594, -.05]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]}><planeGeometry args={[1.05, .49]} /><meshStandardMaterial map={stamp} transparent roughness={1} depthWrite={false} /></mesh>
      <mesh ref={corner} geometry={labelGeometry} position={[PLAQUE_X, PLAQUE_Y, PLAQUE_Z]} castShadow receiveShadow renderOrder={1}><meshStandardMaterial map={plaqueBase} side={THREE.DoubleSide} roughness={.96} /></mesh>
      <mesh geometry={labelGeometry} position={[PLAQUE_X, PLAQUE_Y, PLAQUE_Z + .002]} renderOrder={2} visible={!morphReady}><meshStandardMaterial map={plaqueLogo} side={THREE.DoubleSide} roughness={.96} transparent depthWrite={false} /></mesh>
      <mesh geometry={labelGeometry} position={[PLAQUE_X, PLAQUE_Y, PLAQUE_Z + .004]} renderOrder={3} visible={!morphReady || !nameMorph}><meshStandardMaterial map={plaqueName} side={THREE.DoubleSide} roughness={.96} transparent depthWrite={false} /></mesh>
      {logoMorph && <mesh geometry={labelGeometry} position={[PLAQUE_X, PLAQUE_Y, PLAQUE_Z + .006]} renderOrder={4} visible={morphReady}><meshStandardMaterial map={logoMorph.texture} side={THREE.DoubleSide} roughness={.96} transparent depthWrite={false} /></mesh>}
      {nameMorph && <mesh geometry={labelGeometry} position={[PLAQUE_X, PLAQUE_Y, PLAQUE_Z + .008]} renderOrder={5} visible={morphReady}><meshStandardMaterial map={nameMorph.texture} side={THREE.DoubleSide} roughness={.96} transparent depthWrite={false} /></mesh>}
      <Part at={[1.172, -.36, .25]} size={[.003, .016, .66]} radius={.001} color="#8c6c47" roughness={1} metal={0} />
      {[0, .10, .19].map((z, i) => <Part key={z} at={[1.174, -.27, z]} size={[.005, .12, i % 2 ? .018 : .034]} radius={.001} color="#8c6c47" roughness={1} metal={0} />)}
    </group>
    <group ref={machineBottom} visible={hasMachine} position={[0, 3.8, 0]}>
    <group ref={gantry} position={[0, 0, 0]} name="rail-supported-scan-gantry">
      {[-1, 1].map(sign => <group key={`arm${sign}`}>
        <Part at={[sign * DIM.railX, 1.40, 0]} size={[.47, .24, .61]} radius={.065} color="#596260" metal={.6} />
        <Part at={[sign * DIM.railX, 2.00, 0]} size={[.36, 1.36, .35]} radius={.065} color="#3b4141" metal={.55} />
        <Part at={[sign * 1.748, 2.03, .005]} size={[.018, 1.02, .115]} radius={.007} color="#8a9b89" metal={.8} />
        <Screw at={[sign * DIM.railX, 1.449, .313]} />
        <Screw at={[sign * DIM.railX, 2.65, .188]} />
      </group>)}
      <Part at={[0, 2.80, 0]} size={[4.18, .34, .43]} radius={.09} color="#363c3c" metal={.5} />
      <Part at={[0, 2.984, -.017]} size={[3.24, .039, .27]} radius={.015} color="#555d58" metal={.55} />
      <Part at={[0, 2.615, 0]} size={[3.11, .050, .15]} radius={.015} color="#142d1f" roughness={.5} metal={.3} />
      <mesh position={[0, 2.586, .007]}><boxGeometry args={[2.91, .014, .047]} /><meshStandardMaterial ref={emitter} color="#EFE9E3" emissive="#C9B59C" emissiveIntensity={.015} roughness={.2} /></mesh>
      <mesh position={[0, 2.678, .221]}><boxGeometry args={[2.62, .012, .009]} /><meshStandardMaterial ref={frontEmitter} color="#324b3c" emissive="#EFE9E3" emissiveIntensity={.015} roughness={.45} /></mesh>
      {[...Array(9)].map((_, i) => <Part key={`vent${i}`} at={[1.00 + i * .082, 2.807, .22]} size={[.033, .115, .008]} radius={.006} color="#1c2d21" metal={.15} />)}
      <Part at={[-1.34, 2.82, .223]} size={[.35, .031, .005]} radius={.004} color="#acb49c" roughness={.7} />
    </group>
    <group ref={scan} visible={false}>
      <mesh position={[0, BOX_TOP_Y + .007, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[DIM.boxWidth - .055, .035]} /><meshBasicMaterial color="#D9CFC7" transparent opacity={.78} toneMapped={false} depthWrite={false} /></mesh>
      {[-1, 1].map(sign => <mesh key={sign} position={[sign * (DIM.boxWidth / 2 + .004), BOX_CENTER_Y, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[.029, DIM.boxHeight - .04]} /><meshBasicMaterial color="#EFE9E3" side={THREE.DoubleSide} transparent opacity={.55} toneMapped={false} depthWrite={false} /></mesh>)}
      <mesh position={[0, BOX_TOP_Y + .06, 0]}><planeGeometry args={[2.6, .11]} /><meshBasicMaterial color="#C9B59C" transparent opacity={.12} side={THREE.DoubleSide} depthWrite={false} /></mesh>
    </group>
    {[...Array(8)].map((_, i) => <Part key={`sidevent${i}`} at={[2.302, .755, -.65 + i * .12]} size={[.005, .22, .035]} radius={.002} color="#17271d" />)}
    <Paper phase={phase} motion={motion} result={result} />
    </group>
  </group>
}

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { console.warn('WebGL unavailable:', error.message) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
function Fallback() {
  const { t } = useI18n()
  return <div className="fp-custom-scene-fallback" role="status"><strong>{t('detect.scene.unavailable')}</strong><p>{t('detect.scene.unavailableBody')}</p></div>
}

export default function ScannerScene(props: Props) {
  const { t } = useI18n()
  const [hidden, setHidden] = useState(document.hidden)
  const [ready, setReady] = useState(false)
  const [lost, setLost] = useState(false)
  const [inView, setInView] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [reset, setReset] = useState(0)
  useEffect(() => {
    if (props.phase !== 'scanning') return
    setZoom(1)
    setReset(v => v + 1)
  }, [props.phase])
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  useEffect(() => {
    if (!container.current) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: '80px' })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!ready) return
    const canvas = container.current?.querySelector('canvas')
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? canvas.clientHeight : 1
      const delta = THREE.MathUtils.clamp(event.deltaY * unit, -240, 240)
      setZoom(current => {
        const next = THREE.MathUtils.clamp(current * Math.exp(-delta * .0012), .55, 1.6)
        return Math.abs(next - current) < .001 ? current : +next.toFixed(3)
      })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [ready])
  if (lost) return <Fallback />
  return <SceneBoundary fallback={<Fallback />}>
    <div ref={container} className="fp-custom-scene" data-renderer={ready ? 'webgl' : 'loading'}>
      {!ready && <div className="fp-custom-scene-loading">{t('detect.scene.loading')}</div>}
      <Canvas orthographic camera={{ position: [5.8, 4.75, 8], zoom: 80, near: .1, far: 80 }} dpr={[1, 1.6]} shadows={{ type: THREE.VSMShadowMap }} frameloop={hidden || !inView ? 'never' : 'always'} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => {
        gl.shadowMap.type = THREE.VSMShadowMap
        gl.setClearColor('#000000', 0)
        gl.domElement.addEventListener('webglcontextlost', () => setLost(true), { once: true })
        setReady(true)
      }} fallback={<Fallback />}>
      <CameraRig zoom={zoom} reset={reset} phase={props.phase} />
        <Suspense fallback={null}>
          {!machineShown(props.name)
            ? <ThemeLighting scale={3.25} blur={1.65} far={2.1} position={[.045, .023, DIM.boxZ]}/>
            : <ThemeLighting scale={12}/>}
          <Scanner {...props}/>
        </Suspense>
      </Canvas>
      {ready && <div className="fp-custom-scene-controls" role="group" aria-label={t('detect.scene.view')} data-zoom={zoom.toFixed(2)}>
        <button type="button" title={t('detect.scene.resetView')} aria-label={t('detect.scene.resetView')} onClick={() => { setZoom(1); setReset(v => v + 1) }}><RotateCcw size={16} /></button>
      </div>}
    </div>
  </SceneBoundary>
}



