import { test, expect } from '@playwright/test';

test.describe('Search', { tag: '@Search' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/products.html');
  });

  test('search returns matching products', async ({ page }) => {
    await page.getByLabel('Search products').fill('Laptop');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByTestId('product-card')).toHaveCount(2);
  });

  test('search is case-insensitive', async ({ page }) => {
    await page.getByLabel('Search products').fill('LAPTOP');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(
      page.getByTestId('product-card'),
      'Search should be case-insensitive and return the matching products',
    ).toHaveCount(2);
  });

  test('products page heading is spelled correctly', async ({ page }) => {
    await expect(
      page.getByRole('heading', { level: 1 }),
      'Products page heading text should be spelled correctly',
    ).toHaveText('Available Products');
  });
});
