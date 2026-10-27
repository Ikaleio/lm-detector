import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer } from '@react-three/drei'
import { useTheme } from 'next-themes'

/** Lights and contact shadow for the scanner; colours and intensities come from the `--scene-*` tokens of the current theme. */
export default function ThemeLighting({ scale = 6, blur = 2.7, far = 4, position = [0, .023, 0] }: { scale?: number; blur?: number; far?: number; position?: [number, number, number] }) {
  const theme = useTheme().resolvedTheme === 'dark' ? 'dark' : 'light'
  const { gl, invalidate } = useThree()
  const styles = getComputedStyle(document.documentElement)
  const color = (name: string) => styles.getPropertyValue(`--scene-${name}`).trim()
  const intensity = (name: string) => Number(color(name))
  useEffect(() => {
    gl.setClearColor('#000000', 0)
    gl.domElement.dataset.theme = theme
    invalidate()
  }, [theme, gl, invalidate])
  return <>
    <ambientLight intensity={intensity('ambient')} />
    <hemisphereLight args={[color('sky'), color('ground'), theme === 'dark' ? .8 : 1.35]} />
    <directionalLight position={[-3, 10, 4]} intensity={intensity('key')} color={color('key-color')} castShadow shadow-mapSize={[512, 512]} shadow-camera-left={-4.5} shadow-camera-right={4.5} shadow-camera-top={4.5} shadow-camera-bottom={-4.5} shadow-bias={-.0001} shadow-normalBias={.018} />
    <directionalLight position={[4, 4, -5]} intensity={intensity('fill')} color={color('fill-color')} />
    <Environment key={theme} resolution={128} frames={1}>
      <Lightformer form="rect" intensity={theme === 'dark' ? 1.5 : 2.4} color={color('sky')} position={[-3, 5, 3]} scale={[6, 6, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={theme === 'dark' ? .8 : 1.4} color={color('fill-color')} position={[5, 2, -3]} scale={[4, 6, 1]} target={[0, 1, 0]} />
    </Environment>
    <ContactShadows key={`shadow-${theme}`} opacity={.32} scale={scale} blur={blur} far={far} resolution={256} color={color('shadow')} position={position} frames={1} />
  </>
}
