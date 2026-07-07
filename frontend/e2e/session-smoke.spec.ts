import { test, expect } from '@playwright/test'
import path from 'path'

test.describe('session save/load/restore', () => {
  test('loads a saved session file and restores it through the preview modal', async ({ page }) => {
    await page.goto('/')

    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Load' }).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(path.resolve(import.meta.dirname, '../../qa_synthetic.oligool.json'))

    await expect(page.getByText('Restore session?')).toBeVisible()
    await expect(page.getByText('Synthetic_QA')).toBeVisible()

    await page.getByRole('button', { name: 'Restore' }).click()

    await expect(page.getByText('Loaded "Synthetic_QA"')).toBeVisible()
    await expect(page.getByText('Oligo 1')).toBeVisible()
  })
})
