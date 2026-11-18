/**
 * Boucle de rendu a la demande : au repos, aucune image n'est dessinee
 * (au lieu de 60 im/s en permanence). `step` renvoie vrai tant qu'une
 * animation est en cours (amortissement de la camera, simulation...).
 */
export class RenderLoop {
  private raf = 0
  private pending = 0
  private last = 0

  constructor(private readonly step: (dt: number) => boolean) {}

  /** Demande au moins `frames` images (ex. apres un changement de donnees). */
  invalidate(frames = 1): void {
    this.pending = Math.max(this.pending, frames)
    if (!this.raf) {
      this.last = 0
      this.raf = requestAnimationFrame(this.tick)
    }
  }

  private readonly tick = (now: number): void => {
    this.raf = 0
    // Reprise apres une pause : pas de saut de temps.
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60
    this.last = now
    const more = this.step(dt)
    if (this.pending > 0) this.pending--
    if (more || this.pending > 0) this.raf = requestAnimationFrame(this.tick)
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }
}
