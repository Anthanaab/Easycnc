import type { Bit } from '../data/types'
import { useLoc, useT } from '../i18n'
import { BitIcon } from './BitIcon'

interface Props {
  bits: Bit[]
  value: string
  onChange: (id: string) => void
}

function groupsFor(bits: Bit[]): Array<{ title: string; items: Bit[] }> {
  const isHelix = (b: Bit) => b.type === 'flat' && (b.geom === 'down' || b.geom === 'compression')
  return [
    { title: 'Droites', items: bits.filter((b) => b.type === 'flat' && b.geom !== 'surface' && !isHelix(b)) },
    { title: 'Hélices', items: bits.filter(isHelix) },
    { title: 'Sphériques', items: bits.filter((b) => b.type === 'ball') },
    { title: 'Gravure V', items: bits.filter((b) => b.type === 'vbit') },
    { title: 'Forets / surfaçage', items: bits.filter((b) => b.type === 'drill' || b.geom === 'surface') },
  ].filter((g) => g.items.length)
}

export function BitPicker({ bits, value, onChange }: Props) {
  const t = useT()
  const loc = useLoc()

  return (
    <div className="bit-picker">
      {groupsFor(bits).map((group) => (
        <div key={group.title} className="bit-group">
          <div className="bit-group-title">{t(group.title)}</div>
          <div className="bit-grid">
            {group.items.map((bit) => (
              <button
                key={bit.id}
                type="button"
                className={`bit-btn ${bit.id === value ? 'active' : ''}`}
                title={loc(bit.name, bit.nameEn)}
                onClick={() => onChange(bit.id)}
              >
                <BitIcon type={bit.type} geom={bit.geom} angle={bit.angle} size={34} title={loc(bit.name, bit.nameEn)} />
                <span className="bit-dia">{bit.diameter}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
