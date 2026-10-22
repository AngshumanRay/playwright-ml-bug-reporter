import { test, expect } from '@playwright/test';

test.describe('Profile', { tag: '@Profile' }, () => {
  test('profile shows the logged-in username', { tag: ['@smoke'] }, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('user', 'student'));
    await page.goto('/profile.html');
    await expect(page.getByTestId('profile-username')).toHaveText('student');
  });

  test('saving the profile shows a success message', { tag: ['@sanity'] }, async ({ page }) => {
    await page.goto('/profile.html');
    await page.getByLabel('Display Name').fill('Shruti');
    await page.getByRole('button', { name: 'Save Profile' }).click();
    await expect(
      page.getByRole('status'),
      'Success message should be displayed after saving the profile',
    ).toHaveText('Profile saved successfully', { timeout: 2_000 });
  });

  test('address label is spelled correctly', async ({ page }) => {
    await page.goto('/profile.html');
    await expect(
      page.locator('label[for="address"]'),
      'Address field label text should be spelled correctly',
    ).toHaveText('Address');
  });

  test('save button uses the brand primary colour', async ({ page }) => {
    await page.goto('/profile.html');
    await expect(
      page.getByRole('button', { name: 'Save Profile' }),
      'Save button style should use the brand primary colour',
    ).toHaveCSS('background-color', 'rgb(37, 99, 235)');
  });

  test('order history loads without JavaScript errors', { tag: ['@sanity'] }, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(`Uncaught ${err.name}: ${err.message}`));
    await page.goto('/orders.html');
    await page.waitForLoadState('networkidle');
    expect(pageErrors, 'Order history page crashed with an uncaught JavaScript exception').toEqual([]);
    await expect(page.getByTestId('order-row')).not.toHaveCount(0);
  });
});
