import { loc } from '../i18n'

// Codes GRBL 1.1 (doc officielle grbl/doc/csv). [FR, EN]
const ERRORS: Record<number, [string, string]> = {
  1: ['Mot G-code sans valeur', 'G-code word without value'],
  2: ['Valeur numerique invalide', 'Bad number format'],
  3: ['Commande $ inconnue', 'Invalid $ statement'],
  4: ['Valeur negative refusee', 'Negative value not allowed'],
  5: ['Homing desactive ($22=0)', 'Homing not enabled ($22=0)'],
  6: ['Impulsion de pas trop courte (min 3 µs)', 'Step pulse too short (min 3 µs)'],
  7: ['Lecture EEPROM echouee', 'EEPROM read failed'],
  8: ['Commande $ refusee : GRBL doit etre Idle', '$ command requires Idle state'],
  9: ['G-code verrouille (alarme ou jog) : $X ou $H', 'G-code locked out (alarm/jog): $X or $H'],
  10: ['Limites logicielles sans homing ($20 exige $22)', 'Soft limits require homing ($20 needs $22)'],
  11: ['Ligne trop longue (80 caracteres max)', 'Line too long (80 chars max)'],
  12: ['Pas/s trop eleve pour la carte', 'Step rate exceeded'],
  13: ['Porte de securite ouverte', 'Safety door open'],
  14: ['Ligne de demarrage/info trop longue', 'Startup/build line too long'],
  15: ['Jog hors course machine (limites logicielles)', 'Jog target exceeds machine travel'],
  16: ['Commande jog invalide', 'Invalid jog command'],
  17: ['Mode laser exige une sortie PWM', 'Laser mode requires PWM output'],
  20: ['Commande G-code non supportee', 'Unsupported G-code command'],
  21: ['Deux commandes du meme groupe modal', 'Modal group violation'],
  22: ['Avance F non definie', 'Undefined feed rate'],
  23: ['Valeur entiere attendue', 'Integer value required'],
  24: ['Plusieurs commandes utilisant les axes', 'Multiple axis commands'],
  25: ['Mot G-code repete', 'Repeated G-code word'],
  26: ['Axe manquant pour la commande', 'No axis words in command'],
  27: ['Numero de ligne invalide', 'Invalid line number'],
  28: ['Valeur requise manquante', 'Missing required value'],
  29: ['G59.x non supporte', 'G59.x not supported'],
  30: ['G53 exige G0 ou G1', 'G53 requires G0 or G1'],
  31: ['Mots d\'axe inutilises', 'Unused axis words'],
  32: ['Arc G2/G3 sans axe dans le plan', 'G2/G3 arc missing in-plane axis'],
  33: ['Cible de mouvement invalide (arc impossible)', 'Invalid motion target (bad arc)'],
  34: ['Rayon d\'arc invalide', 'Invalid arc radius'],
  35: ['Arc G2/G3 sans offset dans le plan', 'G2/G3 arc missing in-plane offset'],
  36: ['Mots G-code inutilises', 'Unused G-code words'],
  37: ['Correction d\'outil sur un mauvais axe', 'Tool length offset on wrong axis'],
  38: ['Numero d\'outil trop grand', 'Tool number too large'],
}

const ALARMS: Record<number, [string, string]> = {
  1: ['Fin de course materiel declenche : position perdue, refaites le homing', 'Hard limit triggered: position lost, re-home'],
  2: ['Cible hors course (limite logicielle) : position conservee, $X pour deverrouiller', 'Soft limit: target out of travel, $X to unlock'],
  3: ['Reset pendant un mouvement : position perdue, refaites le homing', 'Reset while in motion: position lost, re-home'],
  4: ['Palpage : palpeur deja en contact avant le depart', 'Probe already triggered before cycle'],
  5: ['Palpage : aucun contact sur la course (verifiez cablage / course)', 'Probe failed: no contact within travel'],
  6: ['Homing : reset pendant le cycle', 'Homing reset during cycle'],
  7: ['Homing : porte ouverte pendant le cycle', 'Homing: door opened during cycle'],
  8: ['Homing : fin de course non libere au degagement ($27)', 'Homing: switch not cleared on pull-off ($27)'],
  9: ['Homing : fin de course non trouve (course $130-$132 / cablage)', 'Homing: switch not found (travel / wiring)'],
  10: ['Homing : fin de course non trouve en double approche', 'Homing: switch not found on second search'],
}

/** Ajoute une explication lisible a une ligne "error:N" ou "ALARM:N" de GRBL. */
export function describeGrblCode(line: string): string {
  const match = /(error|ALARM):(\d+)/.exec(line)
  if (!match) return line
  const table = match[1] === 'error' ? ERRORS : ALARMS
  const entry = table[Number(match[2])]
  return entry ? `${line} — ${loc(entry[0], entry[1])}` : line
}
