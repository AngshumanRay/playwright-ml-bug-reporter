import { test, expect, Page } from '@playwright/test';

/** Puts items into the cart (browser localStorage) before the page loads. */
async function seedCart(page: Page, items: object[]) {
  await page.addInitScript((cart) => localStorage.setItem('cart', cart), JSON.stringify(items));
}

test.describe('Cart', { tag: '@Cart' }, () => {
  test('adding a product updates the cart badge', async ({ page }) => {
    await page.goto('/products.html');
    await page.getByTestId('product-card').filter({ hasText: 'Wireless Mouse' })
      .getByRole('button', { name: 'Add to cart' }).click();
    await expect(
      page.getByTestId('cart-count'),
      'Cart badge count should update after adding a product to the cart',
    ).toHaveText('1', { timeout: 2_000 });
  });

  test('removing a product empties the cart', async ({ page }) => {
    await seedCart(page, [{ id: 5, name: 'USB-C Cable', price: '9.99', qty: 1 }]);
    await page.goto('/cart.html');
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('cart-row')).toHaveCount(0);
    await expect(page.getByText('Your cart is empty')).toBeVisible();
  });

  test('cart total equals price multiplied by quantity', async ({ page }) => {
    await seedCart(page, [{ id: 2, name: 'Wireless Mouse', price: '29.99', qty: 2 }]);
    await page.goto('/cart.html');
    await expect(
      page.getByTestId('cart-total'),
      'Cart total calculated incorrectly: subtotal should equal price x quantity',
    ).toHaveText('$59.98');
  });
});
