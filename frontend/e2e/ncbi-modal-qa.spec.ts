import { test, expect } from '@playwright/test'
import path from 'path'

test.describe('MSA viewer NCBI link modal', () => {
  test('clicking a sequence label shows whole genome and coding region choices', async ({ page }) => {
    await page.goto('/')

    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Load' }).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(path.resolve(import.meta.dirname, './fixtures/ncbi-modal-qa.oligool.json'))

    await expect(page.getByText('Restore session?')).toBeVisible()
    await page.getByRole('button', { name: 'Restore' }).click()

    await expect(page.getByText('NCBI_Modal_QA Completed')).toBeVisible()

    const mainCanvas = page.locator('canvas').nth(1)
    await expect(mainCanvas).toBeVisible()

    await mainCanvas.click({ position: { x: 10, y: 120 } })

    await expect(page.getByText('Open NCBI record')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Whole genome' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Coding region' })).toBeVisible()
    await expect(page.getByText('CP075563.1')).toBeVisible()
  })

  test('coding region button opens NCBI URL with from/to params', async ({ page, context }) => {
    await page.goto('/')

    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Load' }).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(path.resolve(import.meta.dirname, './fixtures/ncbi-modal-qa.oligool.json'))

    await expect(page.getByText('Restore session?')).toBeVisible()
    await page.getByRole('button', { name: 'Restore' }).click()

    await expect(page.getByText('NCBI_Modal_QA Completed')).toBeVisible()

    const mainCanvas = page.locator('canvas').nth(1)
    await mainCanvas.click({ position: { x: 10, y: 120 } })

    const newPagePromise = context.waitForEvent('page')
    await page.getByRole('button', { name: 'Coding region' }).click()
    const newPage = await newPagePromise
    await newPage.waitForLoadState()

    await expect(newPage).toHaveURL(/https:\/\/www\.ncbi\.nlm\.nih\.gov\/nucleotide\/CP075563\.1/)
    await expect(newPage).toHaveURL(/report=genbank/)
    await expect(newPage).toHaveURL(/blast_rank=1/)
    await expect(newPage).toHaveURL(/RID=5AUCFMJX016/)
    await expect(newPage).toHaveURL(/from=1236097/)
    await expect(newPage).toHaveURL(/to=1236869/)
    await newPage.close()
  })
})
