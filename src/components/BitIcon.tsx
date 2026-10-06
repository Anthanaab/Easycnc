import type { Bit } from '../data/types'

interface Props {
  type: Bit['type']
  geom?: Bit['geom']
  angle?: number
  size?: number
  title?: string
}

/** Dessin schématique d'une fraise (profil), pour l'aperçu. */
export function BitIcon({ type, geom, angle, size = 44, title }: Props) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  }
  const shank = <rect x={15} y={2} width={10} height={26} {...common} />

  let cutter: React.ReactNode = null
  if (type === 'ball') {
    cutter = (
      <>
        <line x1={15} y1={28} x2={15} y2={33} {...common} />
        <line x1={25} y1={28} x2={25} y2={33} {...common} />
        <circle cx={20} cy={37} r={7.5} {...common} />
      </>
    )
  } else if (type === 'vbit') {
    const half = Math.max(3, Math.min(11, (angle ?? 90) / 9))
    cutter = (
      <>
        <line x1={20 - half} y1={28} x2={20 + half} y2={28} {...common} />
        <path d={`M ${20 - half} 28 L 20 45 L ${20 + half} 28`} {...common} />
      </>
    )
  } else if (type === 'drill') {
    cutter = (
      <>
        <line x1={14} y1={28} x2={14} y2={31} {...common} />
        <line x1={26} y1={28} x2={26} y2={31} {...common} />
        <path d="M 14 31 L 20 46 L 26 31" {...common} />
      </>
    )
  } else if (geom === 'surface') {
    cutter = (
      <>
        <rect x={6} y={28} width={28} height={9} {...common} />
        <line x1={11} y1={28} x2={8} y2={37} {...common} />
        <line x1={20} y1={28} x2={20} y2={37} {...common} />
        <line x1={29} y1={28} x2={32} y2={37} {...common} />
      </>
    )
  } else {
    // flat (droite), y compris hélice descendante / compression
    cutter = (
      <>
        <rect x={13} y={28} width={14} height={10} {...common} />
        <line x1={13} y1={30} x2={27} y2={36} {...common} strokeWidth={1} />
        <line x1={13} y1={33} x2={24} y2={38} {...common} strokeWidth={1} />
      </>
    )
  }

  let marks: React.ReactNode = null
  if (geom === 'down') {
    marks = (
      <g {...common} strokeWidth={1.4}>
        <path d="M 9 30 L 9 36 M 6 34 L 9 37 L 12 34" />
      </g>
    )
  } else if (geom === 'compression') {
    marks = (
      <g {...common} strokeWidth={1.4}>
        <path d="M 9 29 L 9 34 M 6 31 L 9 28 L 12 31" />
        <path d="M 9 39 L 9 44 M 6 42 L 9 45 L 12 42" />
      </g>
    )
  }

  return (
    <svg viewBox="0 0 40 48" width={size} height={(size * 48) / 40} className="bit-icon" role="img">
      {title && <title>{title}</title>}
      <line x1={2} y1={46} x2={38} y2={46} stroke="currentColor" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
      {shank}
      {cutter}
      {marks}
    </svg>
  )
}
