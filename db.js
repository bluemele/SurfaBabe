/**
 * db.js — PostgreSQL connection pool + helpers for SurfaBabe CRM
 *
 * BeastMode pattern: pg driver (no ORM), Pool, initDb() runs schema.sql + seeds products.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.on('error', (err) => console.error('DB pool error:', err.message));
  }
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

/**
 * Initialize database: run schema.sql, seed products if empty.
 */
export async function initDb() {
  const p = getPool();

  // Run schema
  const schemaPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await p.query(schema);
  console.log('Database schema initialized');

  // Seed products if table is empty
  const { rows } = await p.query('SELECT count(*)::int AS cnt FROM products');
  if (rows[0].cnt === 0) {
    await seedProducts();
  }
}

async function seedProducts() {
  const productsPath = path.join(
    process.env.KNOWLEDGE_DIR || './knowledge',
    'products.json'
  );
  let products;
  try {
    products = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
  } catch (err) {
    console.error('Cannot seed products — products.json not found:', err.message);
    return;
  }

  for (const p of products) {
    await query(
      `INSERT INTO products (id, name, name_vi, category, price, size, description, ingredients, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.name, p.nameVi || null, p.category, p.price, p.size, p.description, p.ingredients, true]
    );
  }
  // Sync sequence to max id
  await query(`SELECT setval('products_id_seq', (SELECT COALESCE(MAX(id),0) FROM products))`);
  console.log(`Seeded ${products.length} products`);
}

// ---- Customer helpers ----

export async function upsertCustomer(phone, name, language) {
  const { rows } = await query(
    `INSERT INTO customers (phone, name, language)
     VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO UPDATE SET
       name = COALESCE(NULLIF($2, ''), customers.name),
       language = COALESCE(NULLIF($3, ''), customers.language),
       updated_at = NOW()
     RETURNING *`,
    [phone, name || null, language || null]
  );
  return rows[0];
}

export async function getCustomerByPhone(phone) {
  const { rows } = await query('SELECT * FROM customers WHERE phone = $1', [phone]);
  return rows[0] || null;
}

// ---- Order helpers ----

function generateOrderNumber() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return `SB-${ts}-${rand}`;
}

export async function createOrder(customerId, items, address, paymentMethod) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const orderNumber = generateOrderNumber();
    const subtotal = items.reduce((t, i) => t + i.unitPrice * i.quantity, 0);
    const total = subtotal; // shipping added later if needed

    const { rows } = await client.query(
      `INSERT INTO orders (order_number, customer_id, status, subtotal, total, delivery_address, payment_method)
       VALUES ($1, $2, 'confirmed', $3, $4, $5, $6) RETURNING *`,
      [orderNumber, customerId, subtotal, total, address || null, paymentMethod || null]
    );
    const order = rows[0];

    // Insert line items
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.productId || null, item.productName, item.quantity, item.unitPrice, item.unitPrice * item.quantity]
      );
    }

    // Create pending payment
    if (paymentMethod) {
      await client.query(
        `INSERT INTO payments (order_id, amount, method, status) VALUES ($1, $2, $3, 'pending')`,
        [order.id, total, paymentMethod]
      );
    }

    await client.query('COMMIT');
    return order;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateOrderStatus(orderId, status) {
  await query('UPDATE orders SET status = $2, updated_at = NOW() WHERE id = $1', [orderId, status]);
}

export async function getOrderById(orderId) {
  const { rows } = await query('SELECT * FROM orders WHERE id = $1', [orderId]);
  return rows[0] || null;
}

export async function getOrderByNumber(orderNumber) {
  const { rows } = await query('SELECT * FROM orders WHERE order_number = $1', [orderNumber]);
  return rows[0] || null;
}

export async function getCustomerOrders(customerId) {
  const { rows } = await query(
    'SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC',
    [customerId]
  );
  return rows;
}

// ---- Payment helpers ----

export async function confirmPayment(orderId, reference) {
  await query(
    `UPDATE payments SET status = 'confirmed', reference = $2, confirmed_at = NOW()
     WHERE order_id = $1 AND status = 'pending'`,
    [orderId, reference || null]
  );
  await updateOrderStatus(orderId, 'paid');
}

// ---- CRM interaction helpers ----

export async function logInteraction(customerId, type, summary, metadata) {
  await query(
    `INSERT INTO crm_interactions (customer_id, type, summary, metadata) VALUES ($1, $2, $3, $4)`,
    [customerId, type, summary || null, metadata ? JSON.stringify(metadata) : null]
  );
}

// ---- Invoice helpers ----

function generateInvoiceNumber() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return `INV-${ts}-${rand}`;
}

export async function createInvoice(orderId, customerId, amount, dueDate) {
  const invoiceNumber = generateInvoiceNumber();
  const { rows } = await query(
    `INSERT INTO invoices (invoice_number, order_id, customer_id, amount, status, due_date)
     VALUES ($1, $2, $3, $4, 'draft', $5) RETURNING *`,
    [invoiceNumber, orderId, customerId, amount, dueDate || null]
  );
  return rows[0];
}

// ---- Health check ----

export async function dbHealthCheck() {
  try {
    const { rows } = await query('SELECT 1 AS ok');
    return { connected: true, ok: rows[0].ok === 1 };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}
