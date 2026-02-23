/**
 * orders.js — Order flow state machine for SurfaBabe Wellness
 *
 * States: idle → collecting_items → collecting_address → collecting_payment → confirming → complete
 *
 * Persisted per-chat in data/<chatJid>/order.json
 * Completed orders saved to data/orders/<timestamp>.json
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';
const ORDERS_DIR = path.join(DATA_DIR, 'orders');

// Ensure orders dir exists
if (!fs.existsSync(ORDERS_DIR)) {
  fs.mkdirSync(ORDERS_DIR, { recursive: true });
}

// In-memory cache of active orders
const activeOrders = new Map();

function orderFile(chatJid) {
  const sanitized = chatJid.replace(/[^a-zA-Z0-9]/g, '_');
  const dir = path.join(DATA_DIR, sanitized);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'order.json');
}

function loadOrder(chatJid) {
  if (activeOrders.has(chatJid)) return activeOrders.get(chatJid);
  try {
    const data = fs.readFileSync(orderFile(chatJid), 'utf-8');
    const order = JSON.parse(data);
    activeOrders.set(chatJid, order);
    return order;
  } catch {
    return { status: 'idle', items: [], customerName: null, address: null, paymentMethod: null };
  }
}

function saveOrder(chatJid, order) {
  activeOrders.set(chatJid, order);
  try {
    fs.writeFileSync(orderFile(chatJid), JSON.stringify(order, null, 2));
  } catch (err) {
    console.error('Failed to save order:', err.message);
  }
}

export function getOrderState(chatJid) {
  return loadOrder(chatJid);
}

export function startOrder(chatJid) {
  const order = {
    status: 'collecting_items',
    items: [],
    customerName: null,
    address: null,
    paymentMethod: null,
    startedAt: new Date().toISOString(),
  };
  saveOrder(chatJid, order);
  return order;
}

export function addToCart(chatJid, productName, productId, price, quantity = 1) {
  const order = loadOrder(chatJid);
  if (order.status === 'idle') {
    order.status = 'collecting_items';
    order.startedAt = new Date().toISOString();
  }

  // Check if item already in cart
  const existing = order.items.find(i => i.productId === productId);
  if (existing) {
    existing.quantity += quantity;
  } else {
    order.items.push({
      productId,
      name: productName,
      price,
      quantity,
    });
  }

  saveOrder(chatJid, order);
  return order;
}

export function removeFromCart(chatJid, productId) {
  const order = loadOrder(chatJid);
  order.items = order.items.filter(i => i.productId !== productId);
  saveOrder(chatJid, order);
  return order;
}

export function setAddress(chatJid, address) {
  const order = loadOrder(chatJid);
  order.address = address;
  if (order.status === 'collecting_items' || order.status === 'collecting_address') {
    order.status = 'collecting_payment';
  }
  saveOrder(chatJid, order);
  return order;
}

export function setCustomerName(chatJid, name) {
  const order = loadOrder(chatJid);
  order.customerName = name;
  saveOrder(chatJid, order);
  return order;
}

export function setPayment(chatJid, method) {
  const order = loadOrder(chatJid);
  order.paymentMethod = method;
  if (order.status === 'collecting_payment') {
    order.status = 'confirming';
  }
  saveOrder(chatJid, order);
  return order;
}

export function confirmOrder(chatJid) {
  const order = loadOrder(chatJid);
  order.status = 'complete';
  order.completedAt = new Date().toISOString();

  // Save completed order
  const timestamp = Date.now();
  const orderRecord = {
    ...order,
    chatJid,
    orderId: `SB-${timestamp}`,
  };

  try {
    fs.writeFileSync(
      path.join(ORDERS_DIR, `${timestamp}.json`),
      JSON.stringify(orderRecord, null, 2)
    );
  } catch (err) {
    console.error('Failed to save completed order:', err.message);
  }

  saveOrder(chatJid, order);
  return orderRecord;
}

export function cancelOrder(chatJid) {
  const order = {
    status: 'idle',
    items: [],
    customerName: null,
    address: null,
    paymentMethod: null,
  };
  saveOrder(chatJid, order);
  return order;
}

export function viewCart(chatJid) {
  return loadOrder(chatJid);
}
