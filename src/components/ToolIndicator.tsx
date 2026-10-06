import { useLoc, useT } from '../i18n'
import { useStore } from '../state/store'
import { BitIcon } from './BitIcon'

export function ToolIndicator({ compact = false }: { compact?: boolean }) {
  const bit = useStore((s) => s.bits.find((b) => b.id === s.bitId))
  const loc = useLoc()
  const t = useT()
  if (!bit) return null
  return (
    <div className={`tool-chip ${compact ? 'compact' : ''}`} title={loc(bit.name, bit.nameEn)}>
      <BitIcon type={bit.type} geom={bit.geom} angle={bit.angle} size={compact ? 28 : 36} />
      {compact ? (
        <span>Ø {bit.diameter}</span>
      ) : (
        <div>
          <b>{loc(bit.name, bit.nameEn)}</b>
          <span>
            Ø {bit.diameter} mm · {bit.flutes} {t('dents')}
          </span>
        </div>
      )}
    </div>
  )
}
