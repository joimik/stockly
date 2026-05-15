import { kv } from '@vercel/kv';

const TOKEN = process.env.BOT_TOKEN;
const STATE_KEY = 'stockly:state';
const CHAT_KEY = 'stockly:chat_id';

async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const reply = (chatId, text) => tg('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true });

const fmtMoney = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const fmtNum = n => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString('id-ID');
};

function findItems(state, query) {
  if (!query) return [];
  const q = query.trim().toLowerCase();
  return (state.items || []).filter(i => (i.name || '').toLowerCase().includes(q));
}

function buildReport(state) {
  const items = state.items || [];
  const txs = state.transactions || [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const sales = txs.filter(t => t.type === 'sale' && t.ts >= todayMs);
  const restocks = txs.filter(t => t.type === 'restock' && t.ts >= todayMs);
  const totalRev = sales.reduce((s, t) => s + (t.qty || 0) * (t.price || 0), 0);
  const unitsSold = sales.reduce((s, t) => s + (t.qty || 0), 0);
  const unitsRestocked = restocks.reduce((s, t) => s + (t.qty || 0), 0);
  const totalVal = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.pricePerUnit || 0), 0);

  const aggregate = list => {
    const m = {};
    list.forEach(t => {
      if (!m[t.itemName]) m[t.itemName] = { qty: 0, val: 0, unit: t.unit || '' };
      m[t.itemName].qty += t.qty || 0;
      m[t.itemName].val += (t.qty || 0) * (t.price || 0);
    });
    return Object.entries(m).sort((a, b) => b[1].qty - a[1].qty);
  };
  const salesByItem = aggregate(sales);
  const restocksByItem = aggregate(restocks);

  const byCat = {};
  items.forEach(i => {
    const c = i.category || 'Uncategorized';
    if (!byCat[c]) byCat[c] = { count: 0, units: 0 };
    byCat[c].count++;
    byCat[c].units += Number(i.quantity || 0);
  });

  const threshold = state.settings?.lowStockThreshold ?? 5;
  const low = items.filter(i => Number(i.quantity || 0) <= threshold)
                   .sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0));

  const dateNow = new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

  let r = `*📊 LAPORAN STOCKLY*\n_${dateNow}_\n\n`;
  r += `*▸ RINGKASAN HARI INI*\n`;
  r += `Penjualan: *${sales.length}* transaksi\n`;
  r += `Unit terjual: *${fmtNum(unitsSold)}*\n`;
  r += `Pendapatan: *${fmtMoney(totalRev)}*\n`;
  r += `Restock: *${restocks.length}* transaksi (+${fmtNum(unitsRestocked)} unit)\n\n`;

  if (salesByItem.length) {
    r += `*▸ 📤 PENJUALAN HARI INI*\n`;
    salesByItem.slice(0, 20).forEach(([n, d]) => {
      r += `• ${n}: ${fmtNum(d.qty)} ${d.unit} — ${fmtMoney(d.val)}\n`;
    });
    r += '\n';
  }
  if (restocksByItem.length) {
    r += `*▸ 📥 RESTOCK HARI INI*\n`;
    restocksByItem.slice(0, 20).forEach(([n, d]) => {
      r += `• ${n}: +${fmtNum(d.qty)} ${d.unit}\n`;
    });
    r += '\n';
  }

  r += `*▸ 📦 RINGKASAN STOK*\n`;
  Object.entries(byCat).sort((a, b) => b[1].units - a[1].units).forEach(([c, d]) => {
    r += `• ${c}: ${d.count} item · ${fmtNum(d.units)} unit\n`;
  });
  r += `Total nilai: *${fmtMoney(totalVal)}*\n\n`;

  r += `*▸ ⚠️ STOK RENDAH (≤${threshold})*\n`;
  if (!low.length) r += `_(semua aman)_\n`;
  else low.slice(0, 25).forEach(i => {
    r += `• ${i.name}: *${fmtNum(Number(i.quantity || 0))}* ${i.unit || ''}\n`;
  });
  return r;
}

function buildLow(state) {
  const items = state.items || [];
  const threshold = state.settings?.lowStockThreshold ?? 5;
  const low = items.filter(i => Number(i.quantity || 0) <= threshold)
                   .sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0));
  if (!low.length) return '✅ Semua stok aman.';
  let r = `*⚠️ STOK RENDAH* (≤${threshold})\n\n`;
  low.forEach(i => {
    r += `• ${i.name}: *${fmtNum(Number(i.quantity || 0))}* ${i.unit || ''}\n`;
  });
  return r;
}

function buildStock(state, query) {
  if (!query) return 'Format: `/stock <nama item>`\nContoh: `/stock chivas`';
  const matches = findItems(state, query);
  if (!matches.length) return `❌ Tidak ditemukan item dengan kata "${query}".`;
  let r = `*🔎 Hasil untuk "${query}"*\n\n`;
  matches.slice(0, 15).forEach(i => {
    const q = Number(i.quantity || 0);
    r += `• *${i.name}* — ${fmtNum(q)} ${i.unit || ''}`;
    if (i.pricePerUnit) r += ` (${fmtMoney(i.pricePerUnit * q)})`;
    r += '\n';
  });
  if (matches.length > 15) r += `\n_…dan ${matches.length - 15} lagi_`;
  return r;
}

function recordTx(state, type, query) {
  const parts = (query || '').trim().split(/\s+/);
  const cmd = type === 'sale' ? '/sold' : '/restock';
  if (parts.length < 2) return { ok: false, msg: `Format: \`${cmd} <nama> <jumlah>\`\nContoh: \`${cmd} bintang 5\`` };
  const qty = parseFloat(parts[parts.length - 1]);
  if (isNaN(qty) || qty <= 0) return { ok: false, msg: 'Jumlah tidak valid.' };
  const itemQuery = parts.slice(0, -1).join(' ');
  const matches = findItems(state, itemQuery);
  if (!matches.length) return { ok: false, msg: `❌ Tidak ditemukan item "${itemQuery}".` };
  if (matches.length > 1) {
    return {
      ok: false,
      msg: `🤔 Ada ${matches.length} item cocok dengan "${itemQuery}":\n\n${matches.slice(0, 6).map(m => `• ${m.name}`).join('\n')}\n\nKetik nama lebih spesifik.`,
    };
  }
  const item = matches[0];
  const cur = Number(item.quantity || 0);
  if (type === 'sale' && qty > cur) {
    return { ok: false, msg: `⚠️ Stok *${item.name}* hanya ${fmtNum(cur)} ${item.unit || ''}. Tidak cukup untuk menjual ${fmtNum(qty)}.` };
  }
  const newQty = type === 'sale' ? cur - qty : cur + qty;
  item.quantity = newQty;
  item.updatedAt = Date.now();
  state.transactions = state.transactions || [];
  state.transactions.unshift({
    id: 't_' + Date.now().toString(36),
    type,
    itemId: item.id,
    itemName: item.name,
    unit: item.unit,
    qty,
    price: Number(item.pricePerUnit || 0),
    note: 'via Telegram',
    ts: Date.now(),
  });
  state.transactions = state.transactions.slice(0, 500);
  state.activity = state.activity || [];
  state.activity.unshift({
    action: 'edit',
    name: `${type === 'sale' ? 'Sold' : 'Restocked'} ${qty} × ${item.name}`,
    ts: Date.now(),
  });
  state.activity = state.activity.slice(0, 30);
  return {
    ok: true,
    msg: `✅ ${type === 'sale' ? '*Terjual*' : '*Restock*'}: ${fmtNum(qty)} × *${item.name}*\n📦 Stok: ${fmtNum(cur)} → *${fmtNum(newQty)}* ${item.unit || ''}`,
  };
}

const HELP = `*🚀 Halo! Saya bot Stockly*

Perintah yang bisa dipakai:
\`/report\` — laporan lengkap hari ini
\`/low\` — daftar stok rendah
\`/stock <nama>\` — cek stok item
\`/sold <nama> <jumlah>\` — catat penjualan
\`/restock <nama> <jumlah>\` — catat restock
\`/help\` — tampilkan bantuan ini

*Contoh:*
\`/stock chivas\`
\`/sold bintang 5\`
\`/restock heineken 24\``;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');
  try {
    const update = req.body || {};
    const msg = update.message;
    if (!msg || !msg.text) return res.status(200).send('OK');
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    await kv.set(CHAT_KEY, chatId);

    let state = (await kv.get(STATE_KEY)) || { items: [], transactions: [], categories: [], settings: {}, activity: [] };

    let response = '';
    let mutated = false;

    if (text === '/start' || text === '/help' || text.startsWith('/start@') || text.startsWith('/help@')) {
      response = HELP;
    } else if (text === '/report' || text.startsWith('/report')) {
      response = buildReport(state);
    } else if (text === '/low' || text.startsWith('/low')) {
      response = buildLow(state);
    } else if (text.startsWith('/stock ')) {
      response = buildStock(state, text.slice(7));
    } else if (text === '/stock') {
      response = 'Format: `/stock <nama>`\nContoh: `/stock chivas`';
    } else if (text.startsWith('/sold ')) {
      const r = recordTx(state, 'sale', text.slice(6));
      response = r.msg; mutated = r.ok;
    } else if (text.startsWith('/restock ')) {
      const r = recordTx(state, 'restock', text.slice(9));
      response = r.msg; mutated = r.ok;
    } else if (text.startsWith('/')) {
      response = 'Perintah tidak dikenal. Ketik /help untuk daftar.';
    } else {
      response = 'Ketik /help untuk lihat perintah.';
    }

    if (mutated) {
      state.lastSync = Date.now();
      await kv.set(STATE_KEY, state);
    }

    await reply(chatId, response);
    return res.status(200).send('OK');
  } catch (e) {
    console.error('telegram handler error', e);
    return res.status(200).send('OK');
  }
}
