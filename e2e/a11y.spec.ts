import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// Audit d'accessibilite (axe-core) de chaque onglet : aucune violation grave.
const TABS = ['Pilotage', 'Conception 2D', 'Vue 3D', 'Laser', 'PCB', 'Relief 3D', 'Réglages GRBL']

for (const tab of TABS) {
  test(`accessibilite : ${tab}`, async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: tab, exact: true }).click()
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    const summary = serious.map((v) => `${v.id} (${v.nodes.length}) : ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
    expect(summary, summary.join('\n')).toEqual([])
  })
}

const audit = async (page: import('@playwright/test').Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.nodes.length}) : ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
}

test('accessibilite : mode atelier', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Atelier', exact: true }).click()
  const issues = await audit(page)
  expect(issues, issues.join('\n')).toEqual([])
})

for (const [button, name] of [
  ['Projets', 'projets'],
  ['Historique', 'historique'],
] as const) {
  test(`accessibilite : fenetre ${name}`, async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: button, exact: true }).click()
    await expect(page.locator('.modal')).toBeVisible()
    const issues = await audit(page)
    expect(issues, issues.join('\n')).toEqual([])
  })
}
