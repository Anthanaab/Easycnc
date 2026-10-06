import { useRef } from 'react'
import { useT } from '../i18n'
import { useStore } from '../state/store'

type SettingType = 'num' | 'mask' | 'bool'
interface SettingRow {
  code: number
  label: string
  hint?: string
  type: SettingType
}
interface SettingGroup {
  title: string
  rows: SettingRow[]
}

const GROUPS: SettingGroup[] = [
  {
    title: "Homing (prise d'origine machine)",
    rows: [
      { code: 22, label: 'Homing activé', hint: '1 = la commande $H est autorisée.', type: 'bool' },
      { code: 23, label: 'Sens du homing', hint: 'Par axe : coché = contact cherché dans l\'autre sens. Le Z doit monter vers le contact du haut.', type: 'mask' },
      { code: 24, label: 'Homing : avance de précision', hint: 'mm/min, dernière approche lente.', type: 'num' },
      { code: 25, label: 'Homing : avance de recherche', hint: 'mm/min, approche rapide.', type: 'num' },
      { code: 27, label: 'Dégagement après contact', hint: 'mm dont la machine recule après contact.', type: 'num' },
    ],
  },
  {
    title: 'Limites',
    rows: [
      { code: 20, label: 'Limites logicielles', hint: '1 = refus des déplacements hors course (nécessite un homing réussi).', type: 'bool' },
      { code: 21, label: 'Limites matérielles', hint: '1 = les fins de course arrêtent la machine.', type: 'bool' },
      { code: 130, label: 'Course X', hint: 'mm.', type: 'num' },
      { code: 131, label: 'Course Y', hint: 'mm.', type: 'num' },
      { code: 132, label: 'Course Z', hint: 'mm.', type: 'num' },
    ],
  },
  {
    title: 'Axes',
    rows: [
      { code: 3, label: 'Sens des moteurs', hint: 'Par axe : coché = sens inversé (à ne changer que si un axe va à l\'envers).', type: 'mask' },
      { code: 100, label: 'Pas/mm X', type: 'num' },
      { code: 101, label: 'Pas/mm Y', type: 'num' },
      { code: 102, label: 'Pas/mm Z', type: 'num' },
      { code: 110, label: 'Vitesse max X', hint: 'mm/min.', type: 'num' },
      { code: 111, label: 'Vitesse max Y', hint: 'mm/min.', type: 'num' },
      { code: 112, label: 'Vitesse max Z', hint: 'mm/min.', type: 'num' },
    ],
  },
  {
    title: 'Broche, laser, palpeur',
    rows: [
      { code: 30, label: 'Vitesse broche maxi (S)', hint: 'Valeur S correspondant à 100 %.', type: 'num' },
      { code: 31, label: 'Vitesse broche mini (S)', type: 'num' },
      { code: 32, label: 'Mode laser', hint: '1 = mode laser. À 0 pour fraiser.', type: 'bool' },
      { code: 6, label: 'Palpeur : signal inversé', hint: '1 si le palpeur est détecté à l\'envers.', type: 'bool' },
    ],
  },
]

const AXIS_BITS: Array<[string, number]> = [
  ['X', 1],
  ['Y', 2],
  ['Z', 4],
]

export function SettingsPanel() {
  const connected = useStore((s) => s.connected)
  const settings = useStore((s) => s.settings)
  const savedSettings = useStore((s) => s.savedSettings)
  const machineId = useStore((s) => s.machineId)
  const readSettings = useStore((s) => s.readSettings)
  const saveSettings = useStore((s) => s.saveSettings)
  const restoreSettings = useStore((s) => s.restoreSettings)
  const exportSettings = useStore((s) => s.exportSettings)
  const importSettings = useStore((s) => s.importSettings)
  const sendCommand = useStore((s) => s.sendCommand)
  const inputRef = useRef<HTMLInputElement>(null)
  const allRef = useRef<HTMLInputElement>(null)
  const t = useT()

  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ version: 1, machines: savedSettings }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'easycnc-reglages.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  const importAll = (json: string) => {
    try {
      const parsed = JSON.parse(json) as { machines?: Record<string, Record<number, string>> }
      const incoming = parsed.machines ?? (parsed as Record<string, Record<number, string>>)
      const merged = { ...savedSettings, ...incoming }
      useStore.setState({ savedSettings: merged })
      localStorage.setItem('savedSettings', JSON.stringify(merged))
    } catch {
      /* ignore */
    }
  }

  const savedCount = Object.keys(savedSettings[machineId] ?? {}).length
  const hasSettings = Object.keys(settings).length > 0

  const setValue = (code: number, value: number) => void sendCommand(`$${code}=${value}`)

  const renderRow = (row: SettingRow) => {
    const raw = settings[row.code]
    const current = raw !== undefined ? Number(raw) : undefined
    return (
      <div className="gsrow" key={row.code}>
        <div className="gsl">
          <b>
            ${row.code} {t(row.label)}
          </b>
          {row.hint && <div className="muted">{t(row.hint)}</div>}
          {current === undefined && <div className="muted">{t('Non renvoyé par la machine.')}</div>}
        </div>
        <div className="gsi">
          {current === undefined ? (
            '—'
          ) : row.type === 'mask' ? (
            <div className="gsmask">
              {AXIS_BITS.map(([axis, bit]) => (
                <label key={axis}>
                  <input
                    type="checkbox"
                    checked={(current & bit) !== 0}
                    onChange={(e) => setValue(row.code, e.target.checked ? current | bit : current & ~bit)}
                  />
                  {axis}
                </label>
              ))}
            </div>
          ) : row.type === 'bool' ? (
            <label>
              <input type="checkbox" checked={current !== 0} onChange={(e) => setValue(row.code, e.target.checked ? 1 : 0)} />
              activé
            </label>
          ) : (
            <input
              type="number"
              step="any"
              defaultValue={current}
              key={`${row.code}-${current}`}
              onBlur={(e) => {
                const value = Number(e.target.value)
                if (!Number.isNaN(value) && value !== current) setValue(row.code, value)
              }}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <section className="panel settings-panel">
      <div className="panel-head">
        <h2>{t('Réglages GRBL')}</h2>
        <button className="btn tiny" disabled={!connected} onClick={readSettings}>
          {t('Lire ($$)')}
        </button>
      </div>

      <div className="settings-actions">
        <button className="btn" disabled={!hasSettings} onClick={saveSettings}>
          {t('Sauvegarder')} ({savedCount})
        </button>
        <button className="btn" disabled={!connected || savedCount === 0} onClick={() => void restoreSettings()}>
          {t('Restaurer')}
        </button>
        <button className="btn" disabled={!hasSettings} onClick={exportSettings}>
          {t('Exporter')}
        </button>
        <button className="btn" disabled={!connected} onClick={() => inputRef.current?.click()}>
          {t('Importer')}
        </button>
        <button className="btn" disabled={!Object.keys(savedSettings).length} onClick={exportAll}>
          {t('Tout exporter')}
        </button>
        <button className="btn" onClick={() => allRef.current?.click()}>
          {t('Tout importer')}
        </button>
        <input
          ref={allRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) importAll(await file.text())
            e.target.value = ''
          }}
        />
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) importSettings(await file.text())
            e.target.value = ''
          }}
        />
      </div>

      <p className="notes">
        {t('Ces réglages sont dans la mémoire de la machine. Modifiez-les un à la fois et notez les valeurs d\'origine (ou sauvegardez-les avant).')}{' '}
        {machineId} : {savedCount}
      </p>

      <div className="settings-body">
        {!connected && <div className="warn">{t('Connectez d\'abord la machine.')}</div>}
        {connected && !hasSettings && <div className="warn">{t('Cliquez sur « Lire ($$) ».')}</div>}
        {GROUPS.map((group) => (
          <div key={group.title}>
            <h4>{t(group.title)}</h4>
            {group.rows.map(renderRow)}
          </div>
        ))}
      </div>
    </section>
  )
}
