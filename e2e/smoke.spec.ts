import { expect, test } from '@playwright/test'

test('app shell loads and navigates tabs', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.brand strong')).toHaveText('EasyCNC')
  await expect(page.locator('.tabs .tab').first()).toContainText('Pilotage')

  await page.getByRole('button', { name: 'Conception 2D' }).click()
  await expect(page.locator('.inspector')).toBeVisible()

  await page.getByRole('button', { name: 'Vue 3D' }).click()
  await expect(page.locator('.view3d-layout')).toBeVisible()

  await page.getByRole('button', { name: 'PCB' }).click()
  await expect(page.locator('.design-layout')).toBeVisible()

  await page.getByRole('button', { name: 'Réglages GRBL' }).click()
  await expect(page.locator('.settings-panel')).toBeVisible()
})

test('add a shape and see it listed', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Conception 2D' }).click()
  await page.getByRole('button', { name: '▭ Rectangle' }).click()
  await expect(page.locator('.shape-item')).toHaveCount(1)
})

test('projects modal opens', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Projets' }).click()
  await expect(page.locator('.modal-head h2')).toContainText('Projets')
})

test('aucun onglet ne provoque d\'erreur JavaScript', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  await page.goto('/')
  for (const name of ['Conception 2D', 'Vue 3D', 'Laser', 'PCB', 'Relief 3D', 'Réglages GRBL', 'Pilotage']) {
    await page.getByRole('button', { name, exact: true }).click()
  }
  expect(errors).toEqual([])
})

test('demarrage impossible sans connexion', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Conception 2D' }).click()
  await page.getByRole('button', { name: '▭ Rectangle' }).click()
  await page.getByRole('button', { name: 'Charger dans Pilotage' }).click()
  await expect(page.getByRole('button', { name: /Démarrer/ })).toBeDisabled()
})
