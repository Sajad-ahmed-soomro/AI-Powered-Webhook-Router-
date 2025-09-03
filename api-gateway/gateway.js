import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyProxy from "@fastify/http-proxy";
import fastifyRateLimit from "@fastify/rate-limit";
import Redis from "ioredis";
import pino from "pino";
import fetch from "node-fetch";
import dotenv from "dotenv";
import fastifyCors from "@fastify/cors";
dotenv.config();
import verifyHmac from "./utils/webhookAuth.js";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = Fastify({ logger: true });

// --- Plugins ---
await app.register(fastifyCors, {
  origin: "http://localhost:3000",
  credentials: true
});

app.register(fastifyJwt, { secret: process.env.JWT_SECRET });

const redis = new Redis(process.env.RATE_LIMIT_REDIS_URL);
app.register(fastifyRateLimit, {
  max: 100,
  timeWindow: "1 minute"
});

// --- JWT check for protected routes ---
app.addHook("preHandler", async (req, reply) => {
  if (req.routerPath && req.routerPath.startsWith("/api")) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing token" });
    }
    try {
      const token = auth.split(" ")[1];
      req.user = app.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "Invalid/expired token" });
    }
  }
});

// --- Keep raw body for webhook verification ---
app.addHook("preValidation", async (req, reply) => {
  if (req.routerPath?.startsWith("/webhook")) {
    let raw = "";
    req.raw.on("data", (chunk) => { raw += chunk; });
    await new Promise((resolve) => req.raw.on("end", resolve));
    req.rawBody = raw;
  }
});

// --- Service proxy config ---
const services = [
  { prefix: "/auth",      upstream: process.env.AUTH_URL,      rewritePrefix: "/auth" },
  { prefix: "/api/logs",  upstream: process.env.INGESTION_URL,      rewritePrefix: "/logs" },
  { prefix: "/api/routing-rules",upstream: process.env.ROUTER_URL,    rewritePrefix: "/api/router-service" },
  { prefix: "/api/processing", upstream: process.env.PROCESSING_URL, rewritePrefix: "/processing" },
  { prefix: "/api/dlq", upstream: process.env.PROCESSING_URL, rewritePrefix: "/" },

  {prefix:"/api",upstream:process.env.ANALYTICS_SERVICE,rewritePrefix:"/api"}
];

// --- Register all proxies in loop ---
for (const { prefix, upstream, rewritePrefix } of services) {
  if (!upstream) {
    logger.warn(`Skipping ${prefix} → missing upstream URL`);
    continue;
  }
  app.register(fastifyProxy, { upstream, prefix, rewritePrefix });
}

// --- Webhook handler ---
app.post("/webhook/:source", async (req, reply) => {
  const { source } = req.params;
  const rawPayload = req.rawBody ?? "{}";
  const payload = JSON.parse(rawPayload);

  const event = req.headers["x-github-event"];
  if (event === "ping") {
    return reply.code(200).send({ message: "Ping received" });
  }

  const signature = req.headers["x-hub-signature-256"];
  const secret = process.env[`${source.toUpperCase()}_SECRET`];
  if (!verifyHmac(payload, signature, secret)) {
    return reply.code(401).send({ error: "Unauthorized webhook" });
  }

  try {
    const res = await fetch("http://localhost:4000/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...req.headers },
      body: JSON.stringify({ source, headers: req.headers, payload: req.body })
    });

    const data = await res.json();
    reply.code(res.status).send(data);
  } catch (err) {
    logger.error("Error forwarding to ingestion:", err);
    reply.code(502).send({ error: "Failed to forward webhook" });
  }
});

// --- Health checks ---


// Add after service registration
app.get("/services/health", async (req, reply) => {
  const healthChecks = await Promise.allSettled(
    services.map(async ({ prefix, upstream }) => {
      if (!upstream) return { service: prefix, status: 'disabled' };
      
      try {
        const res = await fetch(`${upstream}/health`, { timeout: 5000 });
        return { 
          service: prefix, 
          status: res.ok ? 'healthy' : 'unhealthy',
          response_time: res.headers.get('response-time') 
        };
      } catch (err) {
        return { service: prefix, status: 'unhealthy', error: err.message };
      }
    })
  );
  
  reply.send({ services: healthChecks.map(r => r.value) });
});
app.get("/health", async () => ({ status: "ok" }));
app.get("/ready", async () => ({ ready: true }));

// --- Start server ---
const start = async () => {
  try {
    const port = Number(process.env.PORT) || 6000;
    await app.listen({ port, host: "0.0.0.0" });
    logger.info(`API Gateway listening on ${port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};
start();
