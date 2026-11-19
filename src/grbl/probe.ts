import type { ProbeSettings } from '../data/types'
import type { GrblClient } from './GrblClient'
import { trc } from '../i18nCore'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function checkSettings(probe: ProbeSettings): void {
  const finite = [probe.fast, probe.feed, probe.maxDepth, probe.retract, probe.plate].every(Number.isFinite)
  if (!finite) throw new Error(trc('Parametres de palpage invalides'))
  if (probe.fast <= 0 || probe.feed <= 0) throw new Error(trc('Avances de palpage invalides (> 0)'))
  if (probe.maxDepth <= 0) throw new Error(trc('Course max de palpage invalide (> 0)'))
  if (probe.retract <= 0) throw new Error(trc('Degagement de palpage invalide (> 0)'))
  if (probe.plate < 0) throw new Error(trc('Epaisseur de plaque invalide (>= 0)'))
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
    if (!client.lastProbe?.ok) throw new Error(trc('Palpage fin sans contact'))
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
    throw new Error(trc('Parametres de palpage de coin invalides (paroi >= 0, degagement 5-60 mm, outil < 20 mm)'))
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
    if (!client.lastProbe?.ok) throw new Error(trc('Palpage {axis} sans contact', { axis }))
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
    if (!client.lastProbe?.ok) throw new Error(trc('Palpage Z sans contact'))
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

export interface ToolsetterOptions {
  /** Machine referencee : les coordonnees G53 du capteur n'ont de sens qu'apres $H. */
  homed: boolean
  /** Z machine du haut de course (espace GRBL negatif : environ -1). */
  topZ: number
}

/**
 * Mesure la longueur de l'outil sur un capteur fixe (toolsetter) :
 * monte en haut de course, va au-dessus du capteur (G53), palpe vite puis
 * lentement, remonte. Renvoie le Z MACHINE du contact.
 */
export async function measureTool(
  client: GrblClient,
  probe: ProbeSettings,
  options: ToolsetterOptions,
  log: (key: string, params?: Record<string, string | number>) => void,
): Promise<number> {
  checkSettings(probe)
  const x = probe.toolsetterX
  const y = probe.toolsetterY
  const depth = probe.toolsetterDepth ?? 0
  if (!options.homed) throw new Error(trc('Machine non referencee ($H) : position du capteur inconnue'))
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(trc('Position du capteur non definie'))
  }
  if (!(depth > 0 && depth <= 200)) throw new Error(trc('Course de palpage du capteur invalide (1-200 mm)'))
  const f = (v: number) => v.toFixed(3)
  let contact = Number.NaN
  try {
    await client.send('G21')
    await client.send('G90')
    log('Mesure d’outil : montée puis déplacement au-dessus du capteur…')
    // Toujours monter avant tout deplacement XY (jamais de deplacement a basse altitude).
    await client.send(`G53 G0 Z${f(options.topZ)}`)
    await client.send(`G53 G0 X${f(x)} Y${f(y)}`)
    await client.send('G91')
    client.clearLastProbe()
    await client.send(`G38.2 Z-${f(depth)} F${Math.round(probe.fast)}`)
    await client.send('G0 Z2')
    await sleep(150)
    client.clearLastProbe()
    await client.send(`G38.2 Z-4 F${Math.round(probe.feed)}`)
    const result = client.lastProbe
    if (!result?.ok) throw new Error(trc('Mesure d’outil sans contact'))
    contact = result.pos.z
  } finally {
    try {
      await client.send('G90')
      await client.send(`G53 G0 Z${f(options.topZ)}`)
    } catch {
      /* ignore */
    }
  }
  log('Contact capteur à Z machine {z}', { z: contact.toFixed(3) })
  return contact
}

/** Correction de longueur d'outil (G43.1) : nouvel outil plus long -> contact plus haut -> correction positive. */
export function toolLengthOffset(referenceZ: number, newZ: number): number {
  return newZ - referenceZ
}

// ----- Centre de trou / de tenon, bord simple -----

export type EdgeDirection = 'X-' | 'X+' | 'Y-' | 'Y+'

export interface CenterResult {
  x: number
  y: number
  /** Dimension mesuree (diametre du trou, ou largeur du tenon en X / Y). */
  sizeX: number
  sizeY: number
}

const f3 = (v: number) => v.toFixed(3)

/** Position machine courante (rapport d'etat frais). */
async function currentMachinePos(client: GrblClient): Promise<{ x: number; y: number; z: number }> {
  const since = Date.now()
  const status = await client.waitForStatus((s) => s.timestamp >= since && s.mpos !== undefined, 2000)
  return status.mpos!
}

/** Palpe vers `dir` (rapide puis lent) sur un axe ; renvoie la coordonnee MACHINE du contact. */
async function touch(client: GrblClient, probe: ProbeSettings, axis: 'X' | 'Y', dir: number, travel: number): Promise<number> {
  await client.send('G91')
  client.clearLastProbe()
  await client.send(`G38.2 ${axis}${f3(dir * travel)} F${Math.round(probe.fast)}`)
  await client.send(`G0 ${axis}${f3(-dir * 1)}`)
  await sleep(150)
  client.clearLastProbe()
  await client.send(`G38.2 ${axis}${f3(dir * 2)} F${Math.round(probe.feed)}`)
  const result = client.lastProbe
  await client.send(`G0 ${axis}${f3(-dir * 1)}`)
  await client.send('G90')
  if (!result?.ok) throw new Error(trc('Palpage {axis} sans contact', { axis }))
  return axis === 'X' ? result.pos.x : result.pos.y
}

/**
 * Centre d'un trou : outil dans le trou, sous le bord. X des deux cotes, puis Y,
 * puis X de nouveau (plus precis une fois centre en Y). Origine X0 Y0 au centre.
 */
export async function probeHoleCenter(
  client: GrblClient,
  probe: ProbeSettings,
  options: { approxDiameter: number; toolDiameter: number },
  log: (key: string, params?: Record<string, string | number>) => void,
): Promise<CenterResult> {
  checkSettings(probe)
  if (!(options.approxDiameter > 0 && options.approxDiameter <= 100)) throw new Error(trc('Diametre approximatif invalide (0-100 mm)'))
  const travel = options.approxDiameter / 2 + 5
  try {
    await client.send('G21')
    const start = await currentMachinePos(client)
    const across = async (axis: 'X' | 'Y', from: number) => {
      const a = await touch(client, probe, axis, -1, travel)
      await client.send(`G53 G0 ${axis}${f3(from)}`)
      const b = await touch(client, probe, axis, 1, travel)
      const center = (a + b) / 2
      await client.send(`G53 G0 ${axis}${f3(center)}`)
      return { center, size: b - a + options.toolDiameter }
    }
    log('Centre de trou : palpage X…')
    const x1 = await across('X', start.x)
    log('Centre de trou : palpage Y…')
    const y = await across('Y', start.y)
    log('Centre de trou : nouveau palpage X…')
    const x = await across('X', x1.center)
    await client.send('G10 L20 P0 X0 Y0')
    log('Centre de trou : X0 Y0 définis, diamètre mesuré {d} mm', { d: ((x.size + y.size) / 2).toFixed(3) })
    return { x: x.center, y: y.center, sizeX: x.size, sizeY: y.size }
  } finally {
    await client.send('G90').catch(() => undefined)
  }
}

/**
 * Centre d'un tenon / d'une piece : outil AU-DESSUS, a peu pres centre. Pour
 * chaque cote : sortie au-dela du tenon, descente de `depth`, palpage vers le
 * centre, remontee, retour. Origine X0 Y0 au centre.
 */
export async function probeBossCenter(
  client: GrblClient,
  probe: ProbeSettings,
  options: { approxSize: number; depth: number; toolDiameter: number },
  log: (key: string, params?: Record<string, string | number>) => void,
): Promise<CenterResult> {
  checkSettings(probe)
  if (!(options.approxSize > 0 && options.approxSize <= 200)) throw new Error(trc('Taille approximative invalide (0-200 mm)'))
  if (!(options.depth > 0 && options.depth <= 20)) throw new Error(trc('Profondeur de palpage invalide (0-20 mm)'))
  const out = options.approxSize / 2 + options.toolDiameter / 2 + 5
  try {
    await client.send('G21')
    const start = await currentMachinePos(client)
    const side = async (axis: 'X' | 'Y', dir: number, from: number) => {
      // Sortie a hauteur de depart (au-dessus du tenon), descente, palpage vers le centre.
      await client.send('G91')
      await client.send(`G0 ${axis}${f3(dir * out)}`)
      await client.send(`G0 Z${f3(-options.depth)}`)
      await client.send('G90')
      const contact = await touch(client, probe, axis, -dir, out)
      await client.send('G91')
      await client.send(`G0 Z${f3(options.depth)}`)
      await client.send('G90')
      await client.send(`G53 G0 ${axis}${f3(from)}`)
      return contact
    }
    const axisCenter = async (axis: 'X' | 'Y', from: number) => {
      const a = await side(axis, -1, from)
      const b = await side(axis, 1, from)
      const center = (a + b) / 2
      await client.send(`G53 G0 ${axis}${f3(center)}`)
      return { center, size: b - a - options.toolDiameter }
    }
    log('Centre de tenon : palpage X…')
    const x = await axisCenter('X', start.x)
    log('Centre de tenon : palpage Y…')
    const y = await axisCenter('Y', start.y)
    await client.send('G10 L20 P0 X0 Y0')
    log('Centre de tenon : X0 Y0 définis ({w} × {h} mm)', { w: x.size.toFixed(3), h: y.size.toFixed(3) })
    return { x: x.center, y: y.center, sizeX: x.size, sizeY: y.size }
  } finally {
    await client.send('G90').catch(() => undefined)
  }
}

/**
 * Bord simple : outil a cote du bord, a hauteur de palpage, palpe dans le sens
 * indique ; l'origine de l'axe est placee sur le bord (paroi de plaque + rayon).
 */
export async function probeEdge(
  client: GrblClient,
  probe: ProbeSettings,
  options: { direction: EdgeDirection; toolDiameter: number; travel: number },
  log: (key: string, params?: Record<string, string | number>) => void,
): Promise<void> {
  checkSettings(probe)
  if (!(options.travel >= 2 && options.travel <= 60)) throw new Error(trc('Course de palpage invalide (2-60 mm)'))
  const axis = options.direction[0] as 'X' | 'Y'
  const dir = options.direction[1] === '+' ? 1 : -1
  const offset = (probe.xyWall ?? 0) + options.toolDiameter / 2
  try {
    await client.send('G21')
    await client.send('G91')
    client.clearLastProbe()
    await client.send(`G38.2 ${axis}${f3(dir * options.travel)} F${Math.round(probe.fast)}`)
    await client.send(`G0 ${axis}${f3(-dir)}`)
    await sleep(150)
    client.clearLastProbe()
    await client.send(`G38.2 ${axis}${f3(dir * 2)} F${Math.round(probe.feed)}`)
    if (!client.lastProbe?.ok) throw new Error(trc('Palpage {axis} sans contact', { axis }))
    // L'outil est AVANT le bord (dans le sens du palpage) : bord = contact + dir * (rayon + paroi).
    await client.send(`G10 L20 P0 ${axis}${f3(-dir * offset)}`)
    await client.send(`G0 ${axis}${f3(-dir * 2)}`)
    log('Bord {dir} : origine {axis} définie', { dir: options.direction, axis })
  } finally {
    await client.send('G90').catch(() => undefined)
  }
}
