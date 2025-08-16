import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyProxy from "@fastify/http-proxy";
import fastifyRateLimit from "@fastify/rate-limit";
import Redis from "ioredis";
import pino from "pino";
import opossum from "opossum";
import fetch from "node-fetch";
import dotenv from "dotenv";
import fastifyCors from "@fastify/cors";
dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const app = Fastify({ logger:true });

// app.use('/auth', proxy(process.env.AUTH_URL));
await app.register(fastifyCors, {
  origin: "http://localhost:3000",
  credentials: true
});

// JWT plugin (verifies tokens)
app.register(fastifyJwt, { secret: process.env.JWT_SECRET });

// Redis connection for shared rate limiter / cache
const redis = new Redis(process.env.RATE_LIMIT_REDIS_URL);

// Rate limiting (global, backed by in-memory; use Redis plugin for cluster)
app.register(fastifyRateLimit, {
  max: 100, // default per IP
  timeWindow: "1 minute"
  // for clustered env replace with redis limiter plugin
});



// --- Auth hook: attach user if token valid ---
app.addHook("preHandler", async (req, reply) => {
  // only verify for /api/* routes; public routes like /webhook or /auth are excluded
  if (req.routerPath && req.routerPath.startsWith("/api")) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing token" });
    }
    try {
      const token = auth.split(" ")[1];
      const payload = app.jwt.verify(token);
      req.user = payload;
    } catch (err) {
      return reply.code(401).send({ error: "Invalid/expired token" });
    }
  }
});

// --- helper proxy with circuit-breaker + timeout + retries ---
function createProxyWithResilience(targetBaseUrl) {
  // opossum circuit breaker wrapper around a fetch call
  const breakerOptions = {
    timeout: Number(process.env.REQUEST_TIMEOUT_MS) || 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30_000
  };
  const breaker = new opossum(async (opts) => {
    const url = opts.url;
    const res = await fetch(url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      timeout: breakerOptions.timeout
    });
    const text = await res.text();
    return { status: res.status, body: text, headers: Object.fromEntries(res.headers) };
  }, breakerOptions);

  return async function proxyHandler(req, reply) {
    // build downstream url
    const path = req.raw.url.replace(/^\/(api|webhook|auth)/, ""); // adjust mapping as needed
    const url = `${targetBaseUrl}${path}`;
    const opts = {
      url,
      method: req.method,
      headers: { ...req.headers },
      body: req.body && JSON.stringify(req.body)
    };

    try {
      const result = await breaker.fire(opts);
      // copy headers (filter hop-by-hop)
      reply.headers(result.headers);
      reply.code(result.status).send(result.body);
    } catch (err) {
      // fallback
      reply.code(502).send({ error: "Downstream service error", detail: err.message });
    }
  };
}

// --- Mount routes (simple: proxy patterns) ---
// Public: /auth -> auth-service (no JWT required)


// Forward any request starting with /auth to the Auth Service
app.register(fastifyProxy, {
  upstream: process.env.AUTH_URL, // e.g., "http://localhost:5000"
  prefix: "/auth/signup",
  rewritePrefix: "/auth/signup", // keeps /auth in forwarded path
  replyOptions: {
    onResponse: (req, reply, res) => {
      // If you want to passthrough without modifying the response
      reply.send(res);
    }
  }
});


app.register(fastifyProxy, {
  upstream: process.env.AUTH_URL, // e.g., "http://localhost:5000"
  prefix: "/auth/login",
  rewritePrefix: "/auth/login", // keeps /auth in forwarded path
  replyOptions: {
    onResponse: (req, reply, res) => {
      // If you want to passthrough without modifying the response
      reply.send(res);
    }
  }
});


app.post('/webhook/:source', async (req, reply) => {
  const { source } = req.params;
  const payload = req.body;



  const signature = req.headers['x-signature'];
  const secret = process.env[`${source.toUpperCase()}_SECRET`]; // e.g., STRIPE_SECRET
  // Authenticate
  if (!verifyHmac(payload, signature, secret)) {
    return reply.code(401).send({ error: 'Unauthorized webhook' });
  }

  //  Forward to Ingestion Service
  try {
    const url = `${process.env.INGESTION_URL}/logs/}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...req.headers // optional: forward original headers
      },
      body: JSON.stringify({
        source,
        headers: req.headers,
        payload: req.body
      })
    });

    const data = await res.json();
    reply.code(res.status).send(data);

  } catch (err) {
    console.error('Error forwarding to ingestion:', err.message);
    reply.code(502).send({ error: 'Failed to forward webhook' });
  }
});


// Public webhook endpoint (Ingestion) — can validate HMAC instead of JWT
// app.register(fastifyProxy, { upstream: process.env.INGESTION_URL, prefix: "/webhook" });

// // Protected API: /api/logs -> logs-service (JWT verified by preHandler)
// app.register(fastifyProxy, { upstream: process.env.LOGS_URL, prefix: "/api/logs" });

// // Protected API: /api/rules -> settings-service
// app.register(fastifyProxy, { upstream: process.env.AUTH_URL, prefix: "/api/rules" /* replace with actual settings URL */ });

// Health & metrics
app.get("/health", async () => ({ status: "ok" }));
app.get("/ready", async () => ({ ready: true }));

// Start server
const start = async () => {
  try {
    await app.listen({ port: Number(process.env.PORT) || 6000, host: "0.0.0.0" });
     logger.info(`API Gateway listening on ${process.env.PORT || 6000}`);
    console.log(`api gateway is listening at: ${process.env.PORT}`)
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
