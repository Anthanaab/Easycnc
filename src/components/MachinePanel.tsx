import { autoParams } from '../data/params'
import type { Bit } from '../data/types'
import { useLoc, useT } from '../i18n'
import { useStore } from '../state/store'
import { BitPicker } from './BitPicker'

function NumberField({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function MachinePanel() {
  const machines = useStore((s) => s.machines)
  const materials = useStore((s) => s.materials)
  const bits = useStore((s) => s.bits)
  const machineId = useStore((s) => s.machineId)
  const materialId = useStore((s) => s.materialId)
  const bitId = useStore((s) => s.bitId)
  const params = useStore((s) => s.params)
  const probe = useStore((s) => s.probe)
  const setMachine = useStore((s) => s.setMachine)
  const setMaterial = useStore((s) => s.setMaterial)
  const setBit = useStore((s) => s.setBit)
  const setParams = useStore((s) => s.setParams)
  const setProbe = useStore((s) => s.setProbe)
  const duplicateMachine = useStore((s) => s.duplicateMachine)
  const updateMachine = useStore((s) => s.updateMachine)
  const removeMachine = useStore((s) => s.removeMachine)
  const addBit = useStore((s) => s.addBit)
  const duplicateBit = useStore((s) => s.duplicateBit)
  const updateBit = useStore((s) => s.updateBit)
  const removeBit = useStore((s) => s.removeBit)
  const t = useT()
  const loc = useLoc()

  const machine = machines.find((m) => m.id === machineId) ?? machines[0]
  const material = materials.find((m) => m.id === materialId) ?? materials[0]
  const bit = bits.find((b) => b.id === bitId) ?? bits[0]

  const recompute = () => setParams(autoParams(machine, material, bit))

  return (
    <section className="panel">
      <h2>{t('Machine & outil')}</h2>

      <label className="field">
        <span>{t('Profil machine')}</span>
        <select value={machineId} onChange={(e) => setMachine(e.target.value)}>
          {machines.map((m) => (
            <option key={m.id} value={m.id}>
              {loc(m.brand, m.brandEn)} — {loc(m.name, m.nameEn)}
            </option>
          ))}
        </select>
      </label>

      <div className="machine-meta">
        <span>
          {t('Course')} {machine.area.x}×{machine.area.y}×{machine.area.z} mm
        </span>
        <span>{t('Broche')} {machine.spindle.mode === 'manual' ? t('manuelle') : `${machine.spindle.minRpm}-${machine.spindle.maxRpm} tr/min`}</span>
        <span>{t('Homing')} {machine.homing ? t('$H dispo') : t('manuel')}</span>
        <span>{t('Pince')} {machine.collet}</span>
      </div>
      <p className="notes">{loc(machine.notes, machine.notesEn)}</p>

      <div className="two-grid">
        <button className="btn tiny" onClick={() => duplicateMachine(machine.id)}>
          {t('Dupliquer / personnaliser')}
        </button>
        {!machine.builtin && (
          <button className="btn tiny danger" onClick={() => removeMachine(machine.id)}>
            {t('Supprimer le profil')}
          </button>
        )}
      </div>

      {!machine.builtin && (
        <>
          <h3 className="sub">{t('Éditer le profil')}</h3>
          <label className="field">
            <span>{t('Nom')}</span>
            <input value={machine.name} onChange={(e) => updateMachine(machine.id, { name: e.target.value })} />
          </label>
          <div className="params-grid">
            <NumberField label={t('Course X')} value={machine.area.x} step={5} onChange={(v) => updateMachine(machine.id, { area: { ...machine.area, x: v } })} />
            <NumberField label={t('Course Y')} value={machine.area.y} step={5} onChange={(v) => updateMachine(machine.id, { area: { ...machine.area, y: v } })} />
            <NumberField label={t('Course Z')} value={machine.area.z} step={5} onChange={(v) => updateMachine(machine.id, { area: { ...machine.area, z: v } })} />
            <NumberField label={t('Bauds')} value={machine.baud} step={1} onChange={(v) => updateMachine(machine.id, { baud: v })} />
            <NumberField label={t('Avance max')} value={machine.maxFeed} step={50} onChange={(v) => updateMachine(machine.id, { maxFeed: v })} />
            <NumberField label={t('Z sécurité')} value={machine.safeZ} step={1} onChange={(v) => updateMachine(machine.id, { safeZ: v })} />
            <NumberField label={t('S max broche')} value={machine.spindle.maxRpm} step={500} onChange={(v) => updateMachine(machine.id, { spindle: { ...machine.spindle, maxRpm: v } })} />
            <label className="num-field">
              <span>{t('Broche')}</span>
              <select
                value={machine.spindle.mode}
                onChange={(e) => updateMachine(machine.id, { spindle: { ...machine.spindle, mode: e.target.value as 'grbl' | 'manual' } })}
              >
                <option value="grbl">{t('Pilotée (GRBL)')}</option>
                <option value="manual">{t('Manuelle')}</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={machine.homing} onChange={(e) => updateMachine(machine.id, { homing: e.target.checked })} />
            {t('Homing disponible ($H)')}
          </label>
        </>
      )}

      <label className="field">
        <span>{t('Matériau')}</span>
        <select value={materialId} onChange={(e) => setMaterial(e.target.value)}>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {loc(m.name, m.nameEn)}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>
          {t('Fraise')} — <b>{loc(bit.name, bit.nameEn)}</b> (Ø {bit.diameter} mm · {bit.flutes} {t('dents')})
        </span>
      </label>
      <BitPicker bits={bits} value={bitId} onChange={setBit} />

      <div className="two-grid" style={{ marginTop: 8 }}>
        <button className="btn tiny" onClick={addBit}>
          {t('Nouvelle fraise')}
        </button>
        <button className="btn tiny" onClick={() => duplicateBit(bitId)}>
          {t('Dupliquer')}
        </button>
        {!bit.builtin && (
          <button className="btn tiny danger" onClick={() => removeBit(bitId)}>
            {t('Supprimer')}
          </button>
        )}
      </div>

      {!bit.builtin && (
        <>
          <h3 className="sub">{t('Éditer la fraise')}</h3>
          <label className="field">
            <span>{t('Nom')}</span>
            <input value={bit.name} onChange={(e) => updateBit(bit.id, { name: e.target.value, nameEn: e.target.value })} />
          </label>
          <div className="params-grid">
            <label className="num-field">
              <span>{t('Type')}</span>
              <select value={bit.type} onChange={(e) => updateBit(bit.id, { type: e.target.value as Bit['type'] })}>
                <option value="flat">{t('Droite')}</option>
                <option value="ball">{t('Sphérique')}</option>
                <option value="vbit">{t('Gravure V')}</option>
                <option value="drill">{t('Foret')}</option>
              </select>
            </label>
            <NumberField label={t('Diamètre (mm)')} value={bit.diameter} step={0.05} onChange={(v) => updateBit(bit.id, { diameter: v })} />
            <NumberField label={t('dents')} value={bit.flutes} step={1} onChange={(v) => updateBit(bit.id, { flutes: Math.max(1, Math.round(v)) })} />
            {bit.type === 'vbit' && (
              <>
                <NumberField label={t('Angle (°)')} value={bit.angle ?? 90} step={5} onChange={(v) => updateBit(bit.id, { angle: v })} />
                <NumberField label={t('Profondeur max (mm)')} value={bit.docMax ?? 3} step={0.1} onChange={(v) => updateBit(bit.id, { docMax: v })} />
              </>
            )}
            <NumberField label={t('Longueur de coupe (mm)')} value={bit.cutLength} step={1} onChange={(v) => updateBit(bit.id, { cutLength: v })} />
            <NumberField label={t('Queue (mm)')} value={bit.shank} step={0.1} onChange={(v) => updateBit(bit.id, { shank: v })} />
            {bit.type === 'flat' && (
              <label className="num-field">
                <span>{t('Forme')}</span>
                <select value={bit.geom ?? 'straight'} onChange={(e) => updateBit(bit.id, { geom: e.target.value as Bit['geom'] })}>
                  <option value="straight">{t('Droite')}</option>
                  <option value="down">{t('Hélice descendante')}</option>
                  <option value="compression">{t('Compression')}</option>
                  <option value="surface">{t('Surfaçage')}</option>
                </select>
              </label>
            )}
          </div>
        </>
      )}

      <div className="params-head">
        <h3>{t('Paramètres de coupe')}</h3>
        <button className="btn tiny" onClick={recompute} title="Recalculer depuis machine + matériau + fraise">
          {t('Recalculer')}
        </button>
      </div>
      <div className="params-grid">
        <NumberField label={t('Vitesse S')} value={params.rpm} step={100} onChange={(v) => setParams({ rpm: v })} />
        <NumberField label={t('Avance F (mm/min)')} value={params.feed} step={10} onChange={(v) => setParams({ feed: v })} />
        <NumberField label={t('Plongée (mm/min)')} value={params.plunge} step={10} onChange={(v) => setParams({ plunge: v })} />
        <NumberField label={t('Passe (mm)')} value={params.doc} step={0.05} onChange={(v) => setParams({ doc: v })} />
        <NumberField label={t('Recouvrement (mm)')} value={params.stepover} step={0.05} onChange={(v) => setParams({ stepover: v })} />
        <NumberField label={t('Z de sécurité (mm)')} value={params.safeZ} step={1} onChange={(v) => setParams({ safeZ: v })} />
      </div>

      <div className="params-head">
        <h3>{t('Palpeur Z (plaque)')}</h3>
      </div>
      <div className="params-grid">
        <NumberField label={t('Épaisseur plaque (mm)')} value={probe.plate} step={0.1} onChange={(v) => setProbe({ plate: v })} />
        <NumberField label={t('Avance fine (mm/min)')} value={probe.feed} step={5} onChange={(v) => setProbe({ feed: v })} />
        <NumberField label={t('Avance rapide (mm/min)')} value={probe.fast} step={10} onChange={(v) => setProbe({ fast: v })} />
        <NumberField label={t('Course max (mm)')} value={probe.maxDepth} step={1} onChange={(v) => setProbe({ maxDepth: v })} />
        <NumberField label={t('Dégagement (mm)')} value={probe.retract} step={1} onChange={(v) => setProbe({ retract: v })} />
      </div>
    </section>
  )
}
