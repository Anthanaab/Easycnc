import { useState } from 'react'
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
  const [hovered, setHovered] = useState<string | null>(null)

  const preview = bits.find((b) => b.id === (hovered ?? value)) ?? bits.find((b) => b.id === value) ?? bits[0]

  return (
    <div className="bit-picker">
      {preview && (
        <div className="bit-preview">
          <BitIcon type={preview.type} geom={preview.geom} angle={preview.angle} size={44} title={loc(preview.name, preview.nameEn)} />
          <div className="bit-preview-text">
            <b>{loc(preview.name, preview.nameEn)}</b>
            <span>
              Ø {preview.diameter} mm · {preview.flutes} {t('dents')}
            </span>
          </div>
        </div>
      )}

      <div className="bit-list">
        {groupsFor(bits).map((group) => (
          <div key={group.title} className="bit-group">
            <div className="bit-group-title">{t(group.title)}</div>
            {group.items.map((bit) => (
              <button
                key={bit.id}
                type="button"
                className={`bit-row ${bit.id === value ? 'active' : ''}`}
                title={loc(bit.name, bit.nameEn)}
                onMouseEnter={() => setHovered(bit.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(bit.id)}
                onBlur={() => setHovered(null)}
                onClick={() => onChange(bit.id)}
              >
                <span className="bit-name">{loc(bit.name, bit.nameEn)}</span>
                <span className="bit-dia">Ø {bit.diameter}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
