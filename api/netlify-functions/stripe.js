/**
 * Stripe Integration - Netlify Function
 * Handles checkout sessions, webhooks, and subscription queries
 */

require('dotenv').config();
const { query } = require('./utils/db');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SITE_URL = process.env.SITE_URL || 'https://aegisiqstockledger.com';

// Plan configuration
const PLANS = {
  professional: {
    name: 'Professional',
    seats: 5,
    extraSeatPrice: 2000, // $20 in cents
    monthly: { amount: 19900, interval: 'month' },
    annual: { amount: 159000, interval: 'year' } // $159/mo * 12 = $1908
  },
  business: {
    name: 'Business',
    seats: 15,
    extraSeatPrice: 1500, // $15 in cents
    monthly: { amount: 39900, interval: 'month' },
    annual: { amount: 319000, interval: 'year' } // $319/mo * 12 = $3828
  }
};

let stripe = null;
function getStripe() {
  if (!stripe) {
    if (!STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured');
    stripe = require('stripe')(STRIPE_SECRET_KEY);
  }
  return stripe;
}

// Auth middleware (inline)
const jwt = require('jsonwebtoken');
function verifyToken(headers) {
  const auth = headers.authorization || headers.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
  } catch { return null; }
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const action = event.queryStringParameters?.action;

  try {
    // Webhook doesn't need auth
    if (action === 'webhook') return await handleWebhook(event, headers);

    // All other actions need auth
    const user = verifyToken(event.headers);
    if (!user) return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };

    switch (action) {
      case 'create-checkout': return await handleCreateCheckout(event, user, headers);
      case 'portal': return await handlePortal(user, headers);
      case 'subscription': return await handleGetSubscription(user, headers);
      case 'seat-usage': return await handleSeatUsage(user, headers);
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid action' }) };
    }
  } catch (error) {
    console.error('Stripe function error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};

async function handleCreateCheckout(event, user, headers) {
  const s = getStripe();
  const body = JSON.parse(event.body || '{}');
  const { plan, period } = body; // plan: 'professional'|'business', period: 'monthly'|'annual'

  const planConfig = PLANS[plan];
  if (!planConfig) throw new Error('Invalid plan');

  const billing = period === 'annual' ? planConfig.annual : planConfig.monthly;

  // Find or create Stripe customer
  let stripeCustomerId = null;
  const userResult = await query('SELECT stripe_customer_id FROM users WHERE id = $1', [user.id]);
  if (userResult.rows.length > 0 && userResult.rows[0].stripe_customer_id) {
    stripeCustomerId = userResult.rows[0].stripe_customer_id;
  } else {
    const customer = await s.customers.create({
      email: user.email,
      name: user.full_name || user.email,
      metadata: { user_id: String(user.id), entity_id: String(user.entity_id) }
    });
    stripeCustomerId = customer.id;
    // Save customer ID — add column if not exists
    try {
      await query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [stripeCustomerId, user.id]);
    } catch (e) {
      console.warn('Could not save stripe_customer_id, column may not exist:', e.message);
    }
  }

  // Create Stripe price on-the-fly (or use lookup_key)
  const price = await s.prices.create({
    unit_amount: billing.amount,
    currency: 'usd',
    recurring: { interval: billing.interval },
    product_data: {
      name: `AegisIQ ${planConfig.name} Plan`,
      metadata: { plan_key: plan }
    }
  });

  const session = await s.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: price.id, quantity: 1 }],
    success_url: `${SITE_URL}/app.html?subscription=success`,
    cancel_url: `${SITE_URL}/pricing.html?subscription=cancelled`,
    subscription_data: {
      metadata: {
        plan: plan,
        period: period,
        entity_id: String(user.entity_id),
        user_id: String(user.id),
        seat_limit: String(planConfig.seats)
      }
    },
    metadata: {
      plan: plan,
      entity_id: String(user.entity_id)
    }
  });

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ success: true, url: session.url, session_id: session.id })
  };
}

async function handlePortal(user, headers) {
  const s = getStripe();
  const userResult = await query('SELECT stripe_customer_id FROM users WHERE id = $1', [user.id]);
  const customerId = userResult.rows[0]?.stripe_customer_id;
  if (!customerId) throw new Error('No subscription found. Please subscribe first.');

  const portalSession = await s.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${SITE_URL}/admin.html`
  });

  return { statusCode: 200, headers, body: JSON.stringify({ success: true, url: portalSession.url }) };
}

async function handleGetSubscription(user, headers) {
  const s = getStripe();
  
  // Get subscription from entity (check entity_subscriptions table first, fallback to Stripe API)
  const entityId = user.entity_id;
  
  try {
    const subResult = await query(
      `SELECT stripe_subscription_id, plan_name, seat_limit, status, current_period_end 
       FROM entity_subscriptions WHERE entity_id = $1 AND status IN ('active', 'trialing') 
       ORDER BY created_at DESC LIMIT 1`, [entityId]
    );
    
    if (subResult.rows.length > 0) {
      const sub = subResult.rows[0];
      return { statusCode: 200, headers, body: JSON.stringify({ 
        success: true, 
        subscription: {
          plan: sub.plan_name,
          seat_limit: sub.seat_limit,
          status: sub.status,
          current_period_end: sub.current_period_end,
          stripe_subscription_id: sub.stripe_subscription_id
        }
      })};
    }
  } catch (e) {
    // Table may not exist yet, fall through
    console.warn('entity_subscriptions table query failed:', e.message);
  }

  // Fallback: check Stripe directly via customer
  const userResult = await query('SELECT stripe_customer_id FROM users WHERE id = $1', [user.id]);
  const customerId = userResult.rows[0]?.stripe_customer_id;
  
  if (customerId) {
    const subscriptions = await s.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
    if (subscriptions.data.length > 0) {
      const sub = subscriptions.data[0];
      const plan = sub.metadata.plan || 'unknown';
      const seatLimit = parseInt(sub.metadata.seat_limit) || (PLANS[plan]?.seats || 5);
      return { statusCode: 200, headers, body: JSON.stringify({ 
        success: true, 
        subscription: {
          plan: plan,
          seat_limit: seatLimit,
          status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          stripe_subscription_id: sub.id
        }
      })};
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true, subscription: null }) };
}

async function handleSeatUsage(user, headers) {
  const entityId = user.entity_id;
  
  // Count active users for this entity
  const countResult = await query(
    'SELECT COUNT(*) as seat_count FROM users WHERE entity_id = $1 AND is_active = true', [entityId]
  );
  const seatsUsed = parseInt(countResult.rows[0]?.seat_count || '0');

  // Get subscription info
  let plan = null;
  let seatLimit = 5; // default
  let status = 'none';
  let subscriptionId = null;

  try {
    const subResult = await query(
      `SELECT stripe_subscription_id, plan_name, seat_limit, status 
       FROM entity_subscriptions WHERE entity_id = $1 AND status IN ('active', 'trialing') 
       ORDER BY created_at DESC LIMIT 1`, [entityId]
    );
    if (subResult.rows.length > 0) {
      plan = subResult.rows[0].plan_name;
      seatLimit = subResult.rows[0].seat_limit;
      status = subResult.rows[0].status;
      subscriptionId = subResult.rows[0].stripe_subscription_id;
    }
  } catch (e) {
    // Fallback if table doesn't exist
    console.warn('entity_subscriptions query failed:', e.message);
    
    // Try Stripe API fallback
    try {
      const s = getStripe();
      const userResult = await query('SELECT stripe_customer_id FROM users WHERE id = $1', [user.id]);
      const customerId = userResult.rows[0]?.stripe_customer_id;
      if (customerId) {
        const subs = await s.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
        if (subs.data.length > 0) {
          plan = subs.data[0].metadata.plan || 'professional';
          seatLimit = parseInt(subs.data[0].metadata.seat_limit) || (PLANS[plan]?.seats || 5);
          status = subs.data[0].status;
          subscriptionId = subs.data[0].id;
        }
      }
    } catch (e2) {
      console.warn('Stripe fallback failed:', e2.message);
    }
  }

  const planLabel = plan ? (PLANS[plan]?.name || plan.charAt(0).toUpperCase() + plan.slice(1)) : 'No Plan';

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      success: true,
      seat_usage: {
        plan: plan,
        plan_label: planLabel,
        seats_used: seatsUsed,
        seat_limit: seatLimit,
        status: status,
        subscription_id: subscriptionId
      }
    })
  };
}

async function handleWebhook(event, headers) {
  const s = getStripe();
  const sig = event.headers['stripe-signature'];
  
  let stripeEvent;
  try {
    if (STRIPE_WEBHOOK_SECRET) {
      stripeEvent = s.webhooks.constructEvent(event.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      stripeEvent = JSON.parse(event.body);
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Webhook verification failed' }) };
  }

  switch (stripeEvent.type) {
    case 'checkout.session.completed': {
      const session = stripeEvent.data.object;
      if (session.mode === 'subscription') {
        await saveSubscription(session);
      }
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = stripeEvent.data.object;
      await updateSubscriptionStatus(sub);
      break;
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
}

async function saveSubscription(session) {
  const plan = session.metadata?.plan || 'professional';
  const entityId = session.metadata?.entity_id;
  const seatLimit = parseInt(session.metadata?.seat_limit || PLANS[plan]?.seats || 5);
  const subscriptionId = session.subscription;

  if (!entityId) {
    console.warn('No entity_id in session metadata, skipping save');
    return;
  }

  try {
    // Ensure entity_subscriptions table exists
    await query(`
      CREATE TABLE IF NOT EXISTS entity_subscriptions (
        id SERIAL PRIMARY KEY,
        entity_id INTEGER NOT NULL,
        stripe_subscription_id TEXT NOT NULL,
        stripe_customer_id TEXT,
        plan_name TEXT NOT NULL,
        seat_limit INTEGER DEFAULT 5,
        status TEXT DEFAULT 'active',
        current_period_end TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Deactivate old subscriptions for this entity
    await query(
      `UPDATE entity_subscriptions SET status = 'replaced', updated_at = NOW() 
       WHERE entity_id = $1 AND status IN ('active', 'trialing')`, [entityId]
    );

    // Insert new subscription
    await query(
      `INSERT INTO entity_subscriptions (entity_id, stripe_subscription_id, stripe_customer_id, plan_name, seat_limit, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [entityId, subscriptionId, session.customer, plan, seatLimit]
    );

    console.log(`✅ Subscription saved for entity ${entityId}: ${plan} plan, ${seatLimit} seats`);
  } catch (e) {
    console.error('Error saving subscription:', e.message);
  }
}

async function updateSubscriptionStatus(sub) {
  try {
    await query(
      `UPDATE entity_subscriptions SET status = $1, current_period_end = $2, updated_at = NOW() 
       WHERE stripe_subscription_id = $3`,
      [sub.status, new Date(sub.current_period_end * 1000), sub.id]
    );
    console.log(`✅ Subscription ${sub.id} status updated to ${sub.status}`);
  } catch (e) {
    console.error('Error updating subscription status:', e.message);
  }
}
