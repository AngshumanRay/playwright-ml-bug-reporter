/**
 * "ShopEase" - the demo web application under test.
 *
 * It contains deliberately SEEDED DEFECTS so the pipeline has real failures to detect:
 *   Login     - apostrophe in username breaks the SQL query           (Critical)
 *   Search    - search is case-sensitive                              (Major)
 *             - "Avaliable Products" heading typo                     (Minor)
 *   Cart      - cart total uses parseInt and drops the cents          (Major)
 *             - add-to-cart API has a random delay                    (FLAKY)
 *   Checkout  - payment gateway returns HTTP 500                      (Critical)
 *   Profile   - "Adress" label typo, grey Save button                 (Minor)
 *             - profile save API has a random delay                   (FLAKY)
 *             - order history crashes with a JavaScript TypeError     (Critical)
 *
 * Run standalone:  npm run demo-app   (Playwright also starts it automatically)
 */
import path from 'node:path';
import express from 'express';
import { config } from '../src/config';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PRODUCTS = [
  { id: 1, name: 'Laptop Pro 14', price: 899.0 },
  { id: 2, name: 'Wireless Mouse', price: 29.99 },
  { id: 3, name: 'Mechanical Keyboard', price: 79.5 },
  { id: 4, name: 'Laptop Stand', price: 34.99 },
  { id: 5, name: 'USB-C Cable', price: 9.99 },
  { id: 6, name: 'Noise Cancelling Headphones', price: 149.0 },
];

const randomDelay = (min: number, max: number) =>
  new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));

app.get('/', (_req, res) => res.redirect('/login.html'));

app.post('/api/login', (req, res) => {
  const { username = '', password = '' } = req.body ?? {};
  // SEEDED DEFECT (Critical): input is concatenated into SQL, so a quote breaks the query
  if (username.includes("'")) {
    const fragment = username.split("'")[1] || "'";
    return res.status(500).json({ error: `Database error: SQLITE_ERROR: near "${fragment}": syntax error` });
  }
  if (username === 'student' && password === 'Password@123') return res.json({ ok: true, username });
  return res.status(401).json({ error: 'Invalid username or password' });
});

app.get('/api/products', (req, res) => {
  const q = String(req.query.q ?? '');
  // SEEDED DEFECT (Major): comparison is case-sensitive
  res.json(PRODUCTS.filter((p) => p.name.includes(q)));
});

app.post('/api/cart/add', async (req, res) => {
  // SEEDED FLAKINESS: slow, unpredictable inventory service (0.3s - 3s)
  await randomDelay(300, 3000);
  const product = PRODUCTS.find((p) => p.id === Number(req.body?.productId));
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true, product });
});

app.post('/api/checkout', (_req, res) => {
  // SEEDED DEFECT (Critical): payment gateway crashes
  res.status(500).json({
    error: '500 Internal Server Error: Payment gateway crashed while processing the transaction',
  });
});

app.post('/api/profile', async (_req, res) => {
  // SEEDED FLAKINESS: profile service sometimes responds slowly (0.3s - 3s)
  await randomDelay(300, 3000);
  res.json({ ok: true });
});

app.get('/api/orders', (_req, res) => {
  // SEEDED DEFECT (Critical): API shape changed to { data } but the page still reads { orders }
  res.json({ data: [{ id: 'ORD-1001', total: 929.99, status: 'Delivered' }] });
});

app.listen(config.demoAppPort, () => {
  console.log(`ShopEase demo app running at http://localhost:${config.demoAppPort}`);
});
