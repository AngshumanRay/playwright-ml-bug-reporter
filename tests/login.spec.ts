import { test, expect } from '@playwright/test';

test.describe('Login', { tag: '@Login' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login.html');
  });

  test('user can log in with valid credentials', { tag: ['@smoke', '@sanity'] }, async ({ page }) => {
    await page.getByLabel('Username').fill('student');
    await page.getByLabel('Password').fill('Password@123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page, 'Valid login should redirect to the products page').toHaveURL(/products\.html/);
  });

  test('invalid password shows an error message', { tag: ['@sanity'] }, async ({ page }) => {
    await page.getByLabel('Username').fill('student');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('alert')).toHaveText('Invalid username or password');
  });

  test('username with special characters is handled safely', { tag: ['@sanity'] }, async ({ page }) => {
    await page.getByLabel('Username').fill("O'Brien");
    await page.getByLabel('Password').fill('anything');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(
      page.getByRole('alert'),
      'Login with special characters should show a normal validation message, not a database error',
    ).toHaveText('Invalid username or password');
  });
});
