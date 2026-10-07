import type { MachineProfile, ProbeSettings } from './types'

const DEFAULT_PROBE: ProbeSettings = { plate: 0, feed: 30, fast: 150, maxDepth: 25, retract: 5 }

const spindle3018 = { mode: 'grbl' as const, minRpm: 3000, maxRpm: 10000, sMax: 1000, spinupSec: 3 }

type MachineSeed = Omit<MachineProfile, 'probe' | 'builtin' | 'collet' | 'maxShank' | 'preamble' | 'postamble'> &
  Partial<Pick<MachineProfile, 'probe'>>

function machine(seed: MachineSeed): MachineProfile {
  return {
    collet: 'ER11',
    maxShank: 7,
    preamble: '',
    postamble: '',
    probe: { ...DEFAULT_PROBE, maxDepth: seed.area.z, ...(seed.probe ?? {}) },
    builtin: true,
    ...seed,
  }
}

export const MACHINES: MachineProfile[] = [
  machine({
    id: 'lunyee-3018-pro-max',
    brand: 'Lunyee',
    name: '3018 Pro Max',
    area: { x: 300, y: 180, z: 80 },
    baud: 115200,
    maxFeed: 2000,
    maxFeedZ: 600,
    rapid: 5000,
    spindle: { ...spindle3018, minRpm: 3000, maxRpm: 10000 },
    homing: true,
    safeZ: 5,
    notes:
      'Fiche Lunyee : 300×180×80 mm, broche 500 W 10 000 tr/min, carte 32 bits GRBL F1.1, 6 fins de course (homing $H), 2000 mm/min max en coupe. Vérifiez la pince et $30 avec "Lire les réglages".',
    notesEn:
      'Lunyee specs: 300×180×80 mm, 500 W spindle at 10,000 rpm, 32-bit GRBL F1.1 board, 6 limit switches (homing $H), 2000 mm/min max cutting. Check the collet and $30 with "Read settings".',
  }),
  machine({
    id: 'genmitsu-3018-prover',
    brand: 'Genmitsu / SainSmart',
    name: '3018-PROVer',
    area: { x: 300, y: 180, z: 45 },
    baud: 115200,
    maxFeed: 1000,
    maxFeedZ: 300,
    rapid: 1500,
    spindle: { ...spindle3018, sMax: 10000 },
    homing: false,
    safeZ: 5,
    notes: 'GRBL 1.1. $30 = 10000 en général : vérifiez avec $$.',
    notesEn: 'GRBL 1.1. $30 is usually 10000: check with $$.',
  }),
  machine({
    id: 'genmitsu-3018-pro',
    brand: 'Genmitsu / SainSmart',
    name: '3018-PRO',
    area: { x: 300, y: 180, z: 45 },
    baud: 115200,
    maxFeed: 1000,
    maxFeedZ: 300,
    rapid: 1500,
    spindle: { ...spindle3018 },
    homing: false,
    safeZ: 5,
    notes: 'GRBL 1.1, sans fins de course : zéro machine manuel.',
    notesEn: 'GRBL 1.1, no limit switches: manual machine zero.',
  }),
  machine({
    id: 'genmitsu-4040-pro',
    brand: 'Genmitsu / SainSmart',
    name: '4040-PRO',
    area: { x: 400, y: 400, z: 78 },
    baud: 115200,
    maxFeed: 1500,
    maxFeedZ: 400,
    rapid: 2500,
    spindle: { ...spindle3018, maxRpm: 10000 },
    homing: true,
    safeZ: 5,
    notes: 'GRBL 1.1 avec fins de course : homing $H disponible.',
    notesEn: 'GRBL 1.1 with limit switches: homing $H available.',
  }),
  machine({
    id: 'generic-3018',
    brand: 'Générique (Vevor, etc.)',
    name: 'CNC 3018 GRBL',
    brandEn: 'Generic (Vevor, etc.)',
    area: { x: 300, y: 180, z: 40 },
    baud: 115200,
    maxFeed: 800,
    maxFeedZ: 250,
    rapid: 1200,
    spindle: { ...spindle3018 },
    homing: false,
    safeZ: 5,
    notes: 'Profil prudent pour les 3018 sans marque : course utile souvent un peu inférieure.',
    notesEn: 'Conservative profile for unbranded 3018: usable travel is often a bit less.',
  }),
  machine({
    id: 'generic-3018-manual',
    brand: 'Générique (Vevor, etc.)',
    name: 'CNC 3018, broche manuelle',
    brandEn: 'Generic (Vevor, etc.)',
    nameEn: 'CNC 3018, manual spindle',
    area: { x: 300, y: 180, z: 40 },
    baud: 115200,
    maxFeed: 800,
    maxFeedZ: 250,
    rapid: 1200,
    spindle: { ...spindle3018, mode: 'manual' },
    homing: false,
    safeZ: 5,
    notes: 'Broche commandée par potentiomètre / interrupteur : le G-code fait une pause (M0).',
    notesEn: 'Spindle controlled by a potentiometer / switch: the G-code pauses (M0).',
  }),
  machine({
    id: 'sienci-longmill-mk2-12',
    brand: 'Sienci',
    name: 'LongMill MK2 12x12',
    area: { x: 305, y: 305, z: 110 },
    baud: 115200,
    maxFeed: 2500,
    maxFeedZ: 800,
    rapid: 4000,
    spindle: { mode: 'manual', minRpm: 10000, maxRpm: 30000, sMax: 1000, spinupSec: 5 },
    homing: true,
    safeZ: 5,
    notes: 'Défonceuse manuelle (type Makita) : réglez la molette. Valeurs à vérifier.',
    notesEn: 'Manual router (Makita type): set the dial. Values to be checked.',
  }),
  machine({
    id: 'custom-grbl',
    brand: 'Personnalisé',
    name: 'GRBL (à régler)',
    brandEn: 'Custom',
    nameEn: 'GRBL (to configure)',
    area: { x: 300, y: 300, z: 50 },
    baud: 115200,
    maxFeed: 1000,
    maxFeedZ: 300,
    rapid: 1500,
    spindle: { ...spindle3018 },
    homing: false,
    safeZ: 5,
    notes: 'Dupliquez ce profil et adaptez-le à votre machine.',
    notesEn: 'Duplicate this profile and adapt it to your machine.',
  }),
]

export const DEFAULT_PROBE_SETTINGS = DEFAULT_PROBE

export function findMachine(id: string, custom: MachineProfile[] = []): MachineProfile {
  return [...MACHINES, ...custom].find((m) => m.id === id) ?? MACHINES[0]
}
