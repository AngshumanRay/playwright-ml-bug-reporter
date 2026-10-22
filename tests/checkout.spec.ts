import { test, expect } from '@playwright/test';

test.describe('Checkout', { tag: '@Checkout' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/checkout.html');
  });

  test('zip code is required', { tag: ['@sanity'] }, async ({ page }) => {
    await page.getByLabel('Full Name').fill('Shruti');
    await page.getByLabel('Street Address').fill('12 MG Road');
    await page.getByLabel('Card Number').fill('4111111111111111');
    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page.getByRole('status')).toHaveText('Zip code is required');
  });

  test('placing an order shows the confirmation', { tag: ['@smoke', '@sanity'] }, async ({ page }) => {
    await page.getByLabel('Full Name').fill('Shruti');
    await page.getByLabel('Street Address').fill('12 MG Road');
    await page.getByLabel('Zip Code').fill('560001');
    await page.getByLabel('Card Number').fill('4111111111111111');
    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(
      page.getByRole('status'),
      'Placing an order should complete the payment and show the order confirmation',
    ).toHaveText('Order confirmed! Thank you for shopping.');
  });
});
