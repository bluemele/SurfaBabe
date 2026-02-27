/**
 * knowledge.js — Product catalog + FAQ loader for SurfaBabe Wellness
 *
 * Loads product data, FAQ, and policies from knowledge/ directory.
 * Cached in memory, hot-reloadable on file change.
 */

import fs from 'fs';
import path from 'path';

const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || './knowledge';

let productsCache = null;
let faqCache = null;
let policiesCache = null;
let voiceCache = null;
let lastLoad = 0;

const RELOAD_INTERVAL = 60_000; // Reload every 60 seconds max

function shouldReload() {
  return Date.now() - lastLoad > RELOAD_INTERVAL;
}

function reloadIfNeeded() {
  if (!shouldReload()) return;
  lastLoad = Date.now();

  // Products
  try {
    const raw = fs.readFileSync(path.join(KNOWLEDGE_DIR, 'products.json'), 'utf-8');
    productsCache = JSON.parse(raw);
  } catch (err) {
    if (!productsCache) productsCache = [];
    console.error('Failed to load products.json:', err.message);
  }

  // FAQ
  try {
    faqCache = fs.readFileSync(path.join(KNOWLEDGE_DIR, 'faq.md'), 'utf-8');
  } catch {
    if (!faqCache) faqCache = '';
  }

  // Policies
  try {
    policiesCache = fs.readFileSync(path.join(KNOWLEDGE_DIR, 'policies.md'), 'utf-8');
  } catch {
    if (!policiesCache) policiesCache = '';
  }

  // Voice guide
  try {
    voiceCache = fs.readFileSync(path.join(KNOWLEDGE_DIR, 'voice.md'), 'utf-8');
  } catch {
    if (!voiceCache) voiceCache = '';
  }
}

// Initial load
reloadIfNeeded();

export function loadProducts() {
  reloadIfNeeded();
  return productsCache || [];
}

export function loadFAQ() {
  reloadIfNeeded();
  return faqCache || '';
}

export function loadPolicies() {
  reloadIfNeeded();
  return policiesCache || '';
}

export function loadVoice() {
  reloadIfNeeded();
  return voiceCache || '';
}

export function formatCatalog() {
  const products = loadProducts();
  if (!products || products.length === 0) return '[No products loaded]';

  return products.map(p => {
    const price = p.price ? `${p.price.toLocaleString()}₫` : 'TBD';
    const lines = [
      `${p.id}. ${p.name}`,
    ];
    if (p.nameVi) lines.push(`   Vietnamese: ${p.nameVi}`);
    lines.push(`   Category: ${p.category}`);
    lines.push(`   Price: ${price}`);
    if (p.size) lines.push(`   Size: ${p.size}`);
    if (p.description) lines.push(`   Details: ${p.description}`);
    if (p.ingredients) lines.push(`   Key ingredients: ${p.ingredients}`);
    if (p.bestSeller) lines.push(`   ⭐ Best Seller`);
    return lines.join('\n');
  }).join('\n\n');
}

export function formatForCustomer(productId) {
  const products = loadProducts();
  const p = products.find(prod => prod.id === productId || prod.id === parseInt(productId));
  if (!p) return null;

  const price = p.price ? `${p.price.toLocaleString()}₫` : 'Ask for pricing';
  const lines = [
    `*${p.name}*`,
  ];
  if (p.nameVi) lines.push(p.nameVi);
  lines.push(`Price: ${price}`);
  if (p.size) lines.push(`Size: ${p.size}`);
  if (p.description) lines.push(`\n${p.description}`);
  if (p.bestSeller) lines.push('\n⭐ Best Seller');
  return lines.join('\n');
}
