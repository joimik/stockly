import { kv } from './_kv.js';

const KEY = 'stockly:state';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const data = (await kv.get(KEY)) || { items: [], transactions: [], categories: [], settings: {}, activity: [], lastSync: 0 };
      return res.status(200).json(data);
    }
    if (req.method === 'PUT') {
      const body = req.body;
      if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body' });
      const stamped = { ...body, lastSync: Date.now() };
      await kv.set(KEY, stamped);
      return res.status(200).json({ ok: true, lastSync: stamped.lastSync });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
