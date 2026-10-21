// Shared helpers for every ShopEase page
const Cart = {
  items() { return JSON.parse(localStorage.getItem('cart') || '[]'); },
  save(items) { localStorage.setItem('cart', JSON.stringify(items)); renderCartBadge(); },
  add(product) {
    const items = Cart.items();
    const existing = items.find((i) => i.id === product.id);
    if (existing) existing.qty += 1; else items.push({ ...product, price: String(product.price), qty: 1 });
    Cart.save(items);
  },
  count() { return Cart.items().reduce((n, i) => n + i.qty, 0); },
};

function renderCartBadge() {
  const badge = document.querySelector('[data-testid="cart-count"]');
  if (badge) badge.textContent = Cart.count();
}

function renderHeader() {
  document.body.insertAdjacentHTML('afterbegin', `
    <header>
      <span class="brand">ShopEase</span>
      <nav>
        <a href="/products.html">Products</a>
        <a href="/profile.html">Profile</a>
        <a href="/orders.html">Orders</a>
        <a href="/login.html">Logout</a>
      </nav>
      <a class="cart-link" href="/cart.html">Cart <span class="badge" data-testid="cart-count">0</span></a>
    </header>`);
  renderCartBadge();
}

const money = (n) => '$' + Number(n).toFixed(2);

document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.dataset.noHeader) renderHeader();
});
