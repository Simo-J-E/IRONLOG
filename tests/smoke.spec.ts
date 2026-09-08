import { test, expect } from '@playwright/test'

test('onboarding and workout logging flow', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('IRONLOG').first()).toBeVisible()
  await page.getByRole('button',{name:/get started|aloita/i}).click()
  await page.getByRole('button',{name:'SELECT'}).click()
  await page.getByRole('button',{name:/start training|aloita treenaaminen/i}).click()
  await expect(page.getByRole('button',{name:/start workout|aloita treeni/i})).toBeVisible()
  await page.getByRole('button',{name:/start workout|aloita treeni/i}).click()
  await page.getByLabel('Set 1 weight').fill('80')
  await page.getByLabel('Set 1 reps').fill('8')
  await page.getByRole('button',{name:'✓'}).first().click()
  await expect(page.getByText(/^(REST|TAUKO)$/)).toBeVisible()
})
