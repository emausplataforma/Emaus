const crypto = require('crypto');

const MP_API_URL = 'https://api.mercadopago.com';
const MP_ACCESS_TOKEN = String(process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
const MP_WEBHOOK_SECRET = String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim();
const BILLING_PROVIDER = String(process.env.BILLING_PROVIDER || 'mercadopago').trim().toLowerCase();

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function moneyFromCents(value) {
  return Number(value || 0) / 100;
}

function providerStatusToLocal(status = '') {
  const value = String(status || '').toLowerCase();
  if (value === 'authorized' || value === 'active') return 'active';
  if (value === 'pending') return 'pending';
  if (value === 'paused') return 'paused';
  if (value === 'cancelled' || value === 'canceled') return 'cancelled';
  if (value === 'rejected') return 'rejected';
  return 'unknown';
}

function webhookSignatureIsValid(req) {
  if (!MP_WEBHOOK_SECRET) return false;
  const signature = String(req.headers['x-signature'] || '').trim();
  const requestId = String(req.headers['x-request-id'] || '').trim();
  if (!signature || !requestId) return false;
  const parts = signature.split(',').map(part => part.trim().split('='));
  const ts = parts.find(([key]) => key === 'ts')?.[1] || '';
  const v1 = parts.find(([key]) => key === 'v1')?.[1] || '';
  const resourceId = String(req.body?.data?.id || req.query?.id || req.query?.['data.id'] || '').trim();
  if (!ts || !v1 || !resourceId) return false;
  const manifest = `id:${resourceId};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex');
  const actual = Buffer.from(v1);
  const calculated = Buffer.from(expected);
  return actual.length === calculated.length && crypto.timingSafeEqual(actual, calculated);
}

async function mercadoPagoRequest(path, options = {}) {
  if (!MP_ACCESS_TOKEN) throw new Error('MERCADOPAGO_ACCESS_TOKEN não foi configurado no Railway.');
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${MP_API_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let payload = {};
  try { payload = await response.json(); } catch (error) {}
  if (!response.ok) {
    const message = payload.message || payload.error || `Mercado Pago respondeu com HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function publicReturnUrl(publicAppUrl, churchSlug) {
  return `${publicAppUrl}/pagamento.html?igreja=${encodeURIComponent(churchSlug || 'igreja')}`;
}

async function saveSubscription(query, data) {
  const result = await query(`INSERT INTO billing_subscriptions
    (church_id, plan_id, provider, provider_subscription_id, payer_email, status, external_reference, checkout_url, amount_cents, currency, provider_data, started_at, current_period_end)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (provider_subscription_id) DO UPDATE SET
      plan_id = EXCLUDED.plan_id,
      payer_email = EXCLUDED.payer_email,
      status = EXCLUDED.status,
      external_reference = EXCLUDED.external_reference,
      checkout_url = COALESCE(EXCLUDED.checkout_url, billing_subscriptions.checkout_url),
      amount_cents = EXCLUDED.amount_cents,
      currency = EXCLUDED.currency,
      provider_data = EXCLUDED.provider_data,
      started_at = COALESCE(EXCLUDED.started_at, billing_subscriptions.started_at),
      current_period_end = EXCLUDED.current_period_end,
      updated_at = NOW()
    RETURNING *`, [
    data.churchId,
    data.planId,
    data.provider || BILLING_PROVIDER,
    data.providerSubscriptionId,
    data.payerEmail,
    data.status || 'pending',
    data.externalReference || '',
    data.checkoutUrl || null,
    data.amountCents || 0,
    data.currency || 'BRL',
    JSON.stringify(data.providerData || {}),
    data.startedAt || null,
    data.currentPeriodEnd || null
  ]);
  return result.rows[0];
}

async function applySubscriptionStatus(query, subscription, providerData) {
  const localStatus = providerStatusToLocal(providerData.status);
  const providerPlanId = providerData.preapproval_plan_id || providerData.preapproval_plan_id || null;
  const currentPeriodEnd = providerData.next_payment_date || providerData.end_date || null;
  const updated = (await query(`UPDATE billing_subscriptions SET status = $1, provider_data = $2, current_period_end = $3, updated_at = NOW()
    WHERE provider_subscription_id = $4 RETURNING *`, [localStatus, JSON.stringify(providerData), currentPeriodEnd, subscription.provider_subscription_id])).rows[0];
  if (!updated) return null;

  if (localStatus === 'active') {
    await query(`UPDATE churches SET plan_id = COALESCE($1, plan_id), monthly_price_cents = $2, status = 'active', trial_ends_at = NULL, updated_at = NOW() WHERE id = $3`, [subscription.plan_id || providerPlanId, subscription.amount_cents, subscription.church_id]);
  } else if (['paused', 'cancelled', 'rejected'].includes(localStatus)) {
    await query(`UPDATE churches SET status = 'paused', updated_at = NOW() WHERE id = $1 AND status <> 'blocked'`, [subscription.church_id]);
  }
  return updated;
}

async function processWebhook({ query, audit, req }) {
  const type = String(req.body?.type || req.body?.topic || req.query?.type || req.query?.topic || '').trim();
  const resourceId = String(req.body?.data?.id || req.query?.id || req.query?.['data.id'] || '').trim();
  const requestId = String(req.headers['x-request-id'] || '').trim();
  if (!type || !resourceId) return { ignored: true, reason: 'missing_type_or_id' };

  const eventKey = `${type}:${resourceId}:${requestId}`;
  const inserted = (await query(`INSERT INTO billing_webhook_events (provider, event_key, event_type, provider_resource_id, payload)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (event_key) DO NOTHING RETURNING id`, ['mercadopago', eventKey, type, resourceId, JSON.stringify(req.body || req.query || {})])).rows[0];
  if (!inserted) return { duplicate: true };

  let result = null;
  if (['subscription_preapproval', 'preapproval', 'subscription'].includes(type)) {
    const providerData = await mercadoPagoRequest(`/preapproval/${encodeURIComponent(resourceId)}`);
    const subscription = (await query('SELECT * FROM billing_subscriptions WHERE provider_subscription_id = $1', [resourceId])).rows[0];
    if (subscription) {
      result = await applySubscriptionStatus(query, subscription, providerData);
      await audit(null, 'billing_subscription_updated', { provider: 'mercadopago', providerSubscriptionId: resourceId, status: providerData.status }, subscription.church_id);
    }
  } else if (['payment', 'payment.created', 'payment.updated'].includes(type)) {
    const providerData = await mercadoPagoRequest(`/v1/payments/${encodeURIComponent(resourceId)}`);
    const externalReference = String(providerData.external_reference || '');
    const subscriptionId = externalReference.match(/subscription:([^:]+)/)?.[1] || null;
    const subscription = subscriptionId ? (await query('SELECT * FROM billing_subscriptions WHERE provider_subscription_id = $1', [subscriptionId])).rows[0] : null;
    await query(`INSERT INTO billing_payments (subscription_id, church_id, provider, provider_payment_id, status, amount_cents, currency, paid_at, provider_data)
      VALUES ($1, $2, 'mercadopago', $3, $4, $5, $6, $7, $8)
      ON CONFLICT (provider_payment_id) DO UPDATE SET status = EXCLUDED.status, amount_cents = EXCLUDED.amount_cents, paid_at = EXCLUDED.paid_at, provider_data = EXCLUDED.provider_data, updated_at = NOW()`, [subscription?.id || null, subscription?.church_id || null, resourceId, providerData.status || 'unknown', cents(providerData.transaction_amount), providerData.currency_id || 'BRL', providerData.date_approved || null, JSON.stringify(providerData)]);
    result = providerData;
  }

  await query('UPDATE billing_webhook_events SET processed = TRUE, processed_at = NOW(), processing_error = $1 WHERE id = $2', [null, inserted.id]);
  return { processed: true, type, resourceId, result };
}

function registerMercadoPagoRoutes({ app, auth, query, audit, publicAppUrl }) {
  app.get('/api/admin/billing/subscriptions', auth(['platform_admin']), async (req, res) => {
    const result = await query(`SELECT s.*, c.name AS church_name, c.slug AS church_slug, p.name AS plan_name
      FROM billing_subscriptions s JOIN churches c ON c.id = s.church_id LEFT JOIN plans p ON p.id = s.plan_id
      ORDER BY s.created_at DESC LIMIT 500`);
    res.json({ provider: BILLING_PROVIDER, configured: Boolean(MP_ACCESS_TOKEN), subscriptions: result.rows.map(row => ({ ...row, amount: moneyFromCents(row.amount_cents) })) });
  });

  app.get('/api/admin/churches/:churchId/billing', auth(['platform_admin']), async (req, res) => {
    const church = (await query('SELECT id, name, slug, plan_id, status, monthly_price_cents FROM churches WHERE id = $1', [req.params.churchId])).rows[0];
    if (!church) return res.status(404).json({ error: 'Igreja não encontrada.' });
    const subscriptions = (await query('SELECT * FROM billing_subscriptions WHERE church_id = $1 ORDER BY created_at DESC', [church.id])).rows;
    const payments = (await query('SELECT * FROM billing_payments WHERE church_id = $1 ORDER BY created_at DESC LIMIT 100', [church.id])).rows;
    res.json({ provider: BILLING_PROVIDER, configured: Boolean(MP_ACCESS_TOKEN), church, subscriptions, payments });
  });

  app.post('/api/admin/churches/:churchId/billing/checkout', auth(['platform_admin']), async (req, res) => {
    if (BILLING_PROVIDER !== 'mercadopago') return res.status(503).json({ error: 'O provedor de cobrança não está configurado como Mercado Pago.' });
    if (!MP_ACCESS_TOKEN) return res.status(503).json({ error: 'MERCADOPAGO_ACCESS_TOKEN ainda não foi configurado no Railway.' });
    const church = (await query('SELECT id, name, slug, plan_id FROM churches WHERE id = $1', [req.params.churchId])).rows[0];
    if (!church) return res.status(404).json({ error: 'Igreja não encontrada.' });
    const planId = String(req.body.planId || church.plan_id || '').trim();
    const email = String(req.body.payerEmail || req.body.email || '').trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido do responsável pelo pagamento.' });
    const plan = (await query('SELECT * FROM plans WHERE id = $1 AND active = TRUE', [planId])).rows[0];
    if (!plan) return res.status(400).json({ error: 'Plano ativo não encontrado.' });
    const externalReference = `emaus:church:${church.id}:plan:${plan.id}:${Date.now()}`;
    const response = await mercadoPagoRequest('/preapproval', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': crypto.randomUUID() },
      body: {
        reason: `Emaús — ${plan.name} — ${church.name}`,
        external_reference: externalReference,
        payer_email: email,
        auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: moneyFromCents(plan.price_cents), currency_id: 'BRL' },
        back_url: publicReturnUrl(publicAppUrl, church.slug),
        status: 'pending'
      }
    });
    const subscription = await saveSubscription(query, {
      churchId: church.id,
      planId: plan.id,
      providerSubscriptionId: response.id,
      payerEmail: email,
      status: providerStatusToLocal(response.status || 'pending'),
      externalReference: `subscription:${response.id}:${externalReference}`,
      checkoutUrl: response.init_point || response.sandbox_init_point || response.external_reference || null,
      amountCents: plan.price_cents,
      currency: 'BRL',
      providerData: response
    });
    await audit(req.user, 'billing_checkout_created', { churchId: church.id, planId: plan.id, provider: 'mercadopago', providerSubscriptionId: response.id }, church.id);
    res.status(201).json({ provider: 'mercadopago', checkoutUrl: subscription.checkout_url, subscription });
  });

  app.post('/api/integrations/mercadopago/webhook', async (req, res) => {
    if (!MP_WEBHOOK_SECRET) return res.status(503).json({ error: 'MERCADOPAGO_WEBHOOK_SECRET ainda não foi configurado.' });
    if (!webhookSignatureIsValid(req)) return res.status(401).json({ error: 'Assinatura do webhook do Mercado Pago inválida.' });
    try {
      const result = await processWebhook({ query, audit, req });
      res.status(200).json({ ok: true, ...result });
    } catch (error) {
      const resourceId = String(req.body?.data?.id || req.query?.id || req.query?.['data.id'] || '').trim();
      if (resourceId) await query(`UPDATE billing_webhook_events SET processed = FALSE, processing_error = $1 WHERE provider_resource_id = $2 AND processed = FALSE`, [error.message, resourceId]).catch(() => {});
      res.status(500).json({ error: 'Não foi possível processar o webhook do Mercado Pago.' });
    }
  });
}

module.exports = { registerMercadoPagoRoutes, providerStatusToLocal };
