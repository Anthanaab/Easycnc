import type { ProbeSettings } from '../data/types'
import type { GrblClient } from './GrblClient'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function checkSettings(probe: ProbeSettings): void {
  const finite = [probe.fast, probe.feed, probe.maxDepth, probe.retract, probe.plate].every(Number.isFinite)
  if (!finite) throw new Error('Parametres de palpage invalides')
  if (probe.fast <= 0 || probe.feed <= 0) throw new Error('Avances de palpage invalides (> 0)')
  if (probe.maxDepth <= 0) throw new Error('Course max de palpage invalide (> 0)')
  if (probe.retract <= 0) throw new Error('Degagement de palpage invalide (> 0)')
  if (probe.plate < 0) throw new Error('Epaisseur de plaque invalide (>= 0)')
}

/**
 * Palpage Z guide sur plaque: approche rapide, degagement, approche fine,
 * puis definition de Z0 (avec l'epaisseur de plaque).
 */
export async function probeZ(
  client: GrblClient,
  probe: ProbeSettings,
  log: (key: string, params?: Record<string, string | number>) => void,
): Promise<void> {
  checkSettings(probe)
  try {
    await client.send('G21')
    await client.send('G91')
    log('Approche rapide (F{fast}, course max {max} mm)…', { fast: probe.fast, max: probe.maxDepth })
    client.clearLastProbe()
    // G38.2 : "ok" seulement a la fin du palpage ; sans contact -> ALARM:5.
    await client.send(`G38.2 Z-${probe.maxDepth.toFixed(3)} F${Math.round(probe.fast)}`)
    await client.send(`G0 Z${probe.retract.toFixed(3)}`)
    await sleep(150)
    log('Approche fine (F{feed})…', { feed: probe.feed })
    client.clearLastProbe()
    await client.send(`G38.2 Z-${(probe.retract + 2).toFixed(3)} F${Math.round(probe.feed)}`)
    if (!client.lastProbe?.ok) throw new Error('Palpage fin sans contact')
    // P0 = repere de travail actif (pas forcement G54).
    await client.send(`G10 L20 P0 Z${probe.plate.toFixed(3)}`)
    await client.send(`G0 Z${probe.retract.toFixed(3)}`)
    log('Z0 défini (plaque {plate} mm), dégagement {retract} mm', { plate: probe.plate, retract: probe.retract })
  } finally {
    try {
      await client.send('G90')
    } catch {
      /* ignore */
    }
  }
}

export type Corner = 'front-left' | 'front-right' | 'back-left' | 'back-right'

export interface CornerProbeOptions {
  corner: Corner
  /** Diametre de l'outil (le centre est a un rayon de la face touchee). */
  toolDiameter: number
}

/**
 * Palpage de coin XYZ (plaque en L posee sur le coin, ou piece conductrice
 * avec xyWall = 0 et plate = 0).
 *
 * Depart : outil au-dessus de la plaque, pres du coin (5 a 15 mm des bords).
 * 1. Z : approche rapide puis fine, Z0 = epaisseur de plaque.
 * 2. X : sort de `xyTravel` vers l'exterieur, descend a mi-hauteur de plaque,
 *    palpe vers la plaque ; X0 = bord de piece (paroi + rayon d'outil).
 * 3. Y : idem dans l'autre axe.
 * Tous les mouvements sont relatifs et bornes ; un palpage sans contact
 * declenche ALARM:5 (arret, la position est conservee).
 */
export async function probeCorner(
  client: GrblClient,
  probe: ProbeSettings,
  options: CornerProbeOptions,
  log: (key: string, params?: Record<string, string | number>) => void,
): Promise<void> {
  checkSettings(probe)
  const wall = probe.xyWall ?? 0
  const travel = probe.xyTravel ?? 15
  const radius = options.toolDiameter / 2
  if (!(wall >= 0) || !(travel >= 5 && travel <= 60) || !(radius > 0 && radius < 10)) {
    throw new Error('Parametres de palpage de coin invalides (paroi >= 0, degagement 5-60 mm, outil < 20 mm)')
  }
  // sx/sy : sens vers l'exterieur de la piece sur chaque axe.
  const sx = options.corner.endsWith('left') ? -1 : 1
  const sy = options.corner.startsWith('front') ? -1 : 1
  const above = probe.retract
  // Hauteur de palpage des faces : mi-hauteur de plaque, ou 2 mm sous le dessus sans plaque.
  const faceDepth = probe.plate > 1 ? probe.plate / 2 : 2
  const edge = (wall + radius).toFixed(3)
  const f = (v: number) => v.toFixed(3)

  const probeAxis = async (axis: 'X' | 'Y', s: number) => {
    // Sortie vers l'exterieur, descente, approche rapide puis fine vers la piece.
    await client.send(`G0 ${axis}${f(s * travel)}`)
    await client.send(`G0 Z${f(-(above + faceDepth))}`)
    client.clearLastProbe()
    await client.send(`G38.2 ${axis}${f(-s * (travel + 5))} F${Math.round(probe.fast)}`)
    await client.send(`G0 ${axis}${f(s * 2)}`)
    await sleep(150)
    client.clearLastProbe()
    await client.send(`G38.2 ${axis}${f(-s * 4)} F${Math.round(probe.feed)}`)
    if (!client.lastProbe?.ok) throw new Error(`Palpage ${axis} sans contact`)
    await client.send(`G10 L20 P0 ${axis}${s < 0 ? '-' : ''}${edge}`)
    // Degagement puis remontee au-dessus de la plaque.
    await client.send(`G0 ${axis}${f(s * 2)}`)
    await client.send(`G0 Z${f(above + faceDepth)}`)
  }

  try {
    await client.send('G21')
    await client.send('G91')
    log('Coin {corner} : palpage Z…', { corner: options.corner })
    client.clearLastProbe()
    await client.send(`G38.2 Z-${probe.maxDepth.toFixed(3)} F${Math.round(probe.fast)}`)
    await client.send(`G0 Z${f(above)}`)
    await sleep(150)
    client.clearLastProbe()
    await client.send(`G38.2 Z-${f(above + 2)} F${Math.round(probe.feed)}`)
    if (!client.lastProbe?.ok) throw new Error('Palpage Z sans contact')
    await client.send(`G10 L20 P0 Z${probe.plate.toFixed(3)}`)
    await client.send(`G0 Z${f(above)}`)

    log('Coin {corner} : palpage X…', { corner: options.corner })
    await probeAxis('X', sx)
    // Retour au-dessus de la piece, 5 mm a l'interieur du bord X, pour palper Y.
    await client.send('G90')
    await client.send(`G0 X${f(-sx * 5)}`)
    await client.send('G91')

    log('Coin {corner} : palpage Y…', { corner: options.corner })
    await probeAxis('Y', sy)
    await client.send('G90')
    await client.send(`G0 Y${f(-sy * 5)}`)
    log('Origine XYZ définie au coin {corner}. Retirez la plaque.', { corner: options.corner })
  } finally {
    try {
      await client.send('G90')
    } catch {
      /* ignore */
    }
  }
}
