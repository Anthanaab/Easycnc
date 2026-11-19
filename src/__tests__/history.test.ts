import { describe, expect, it } from 'vitest'
import { calibrationFrom, type JobRecord } from '../state/jobHistory'

const job = (actual: number, estimated: number, extra: Partial<JobRecord> = {}): JobRecord => ({
  id: Math.random(),
  file: 'a.nc',
  jobType: 'mill',
  dryRun: false,
  startedAt: 0,
  endedAt: actual * 1000,
  outcome: 'done',
  lines: 10,
  estimatedSeconds: estimated,
  ...extra,
})

describe("calibration de l'estimation", () => {
  it('mediane des ratios reel / estime', () => {
    const c = calibrationFrom([job(130, 100), job(120, 100), job(150, 100)])
    expect(c).toEqual({ factor: 1.3, samples: 3 })
  })

  it('ignore les jobs arretes, en reprise ou trop courts', () => {
    const c = calibrationFrom([
      job(300, 100, { outcome: 'stopped' }),
      job(300, 100, { fromLine: 50 }),
      job(300, 10),
      job(110, 100),
      job(130, 100),
    ])
    expect(c?.factor).toBeCloseTo(1.2)
    expect(c?.samples).toBe(2)
  })

  it('borne le coefficient et exige au moins 2 jobs', () => {
    expect(calibrationFrom([job(100, 100)])).toBeNull()
    expect(calibrationFrom([job(1000, 100), job(1000, 100)])?.factor).toBe(3)
  })
})
