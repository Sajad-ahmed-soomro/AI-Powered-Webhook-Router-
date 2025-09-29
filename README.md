


# AI Webhook Router 

A scalable microservices-based platform to **ingest, classify, process, and deliver webhooks** from external services like Stripe, GitHub, Zapier, etc.  
The system ensures reliable processing with retries, logging, monitoring, and secure API key authentication.

---

## 📌 Features
- **Webhook Ingestion** → Accepts incoming webhooks with headers & payloads.
- **AI-based Classification** → Categorizes events (e.g., billing, code, alerts).
- **Retry Queue** → Failed deliveries are retried with exponential backoff.
- **Processing Service** → Extracts structured results from raw payloads.
- **Delivery Service** → Sends processed results to configured destinations.
- **Auth Service** → API key-based authentication & permissions.
- **Analytics** → Logs, dashboards, and insights for webhook traffic.
- **Scalable** → Built with microservices + message queues + PostgreSQL.

---

## 🏗️ Architecture
![WebhookRouterArchitecture drawio](https://github.com/user-attachments/assets/1cac0b2c-57d8-4541-a689-ba7321b0f0bc)  )*

---

## 📂 Project Structure

```

/project-root
├── services/
│   ├── api-gateway/
│   ├── ingestion/
│   ├── router/
│   ├── processing/
│   ├── delivery/
│   ├── auth/
│   └── analytics/
├── README.md

````

---

## 🗄️ Database Schema (Key Tables)

- **users** → Manages platform users.  
- **api_keys** → API key storage (hashed).  
- **ingestion.logs** → Stores raw incoming webhooks.  
- **processed_results** → Stores AI-processed data.  
- **delivery_logs** → Tracks delivery attempts.  
- **retry_queue** → Handles retries for failed deliveries.  

---

## ⚡ Setup & Installation

### 1️⃣ Clone the Repository
```bash
git clone https://github.com/Sajad-ahmed-soomro/AI-Powered-Webhook-Router-.git
cd AI-Powered-Webhook-Router
````

### 2️⃣ Environment Variables

Create a `.env` file at the project root and configure:


```
### 🔹 **Analytics Service** (`/analytics/.env`)

PORT
REDIS_URL
STREAM_KEY
CONSUMER_GROUP
CONSUMER_NAME
PG_HOST
PG_USER
PG_PASSWORD
PG_DATABASE
PG_PORT


### 🔹 API Gateway (`/api-gateway/.env`)


PORT
CORS_ORIGIN
JWT_SECRET
REDIS_URL
RATE_LIMIT_REDIS_URL
CACHE_REDIS_URL
LOG_LEVEL
AUTH_URL
INGESTION_URL
ROUTER_URL
PROCESSING_URL
LOGS_URL
REQUEST_TIMEOUT_MS
ANALYTICS_SERVICE
STRIPE_SECRET
GITHUB_SECRET


### 🔹 Auth Service (`/auth/.env`)


PORT
PG_HOST
PG_USER
PG_PASSWORD
PG_DATABASE
PG_PORT
SECRET


### 🔹 Frontend (`/frontend/.env`)


NEXT_PUBLIC_API_GATEWAY_BASE_URL


### 🔹 Ingestion Service (`/ingestion/.env`)


PORT
PG_HOST
PG_USER
PG_PASSWORD
PG_DATABASE
PG_PORT
REDIS_URL
STREAM_KEY
CONSUMER_GROUP
CONSUMER_NAME
HF_TOKEN


### 🔹 Processing Service (`/processing/.env`)


PORT
REDIS_URL
STREAM_KEY
CONSUMER_GROUP
CONSUMER_NAME
PG_HOST
PG_USER
PG_PASSWORD
PG_DATABASE
PG_PORT


### 🔹 Router Service (`/router/.env`)


PORT
PG_HOST
PG_USER
PG_PASSWORD
PG_DATABASE
PG_PORT
REDIS_URL
STREAM_KEY
CONSUMER_GROUP
CONSUMER_NAME


```




## Deployment Steps (Kubernetes + GitHub Actions)

### 1️⃣ Prerequisites
- Kubernetes cluster ready  
- kubectl installed and configured  
- Docker installed and logged in to Docker Hub  
- GitHub repository secrets:
  - `DOCKER_USER`
  - `DOCKER_PASSWORD`



DATABASE_URL=postgres://postgres:<password>@postgres-svc:5432/microservices
REDIS_URL=redis://redis-svc:6379
JWT_SECRET=<your_jwt_secret>
ANALYTICS_KEY=<your_analytics_key>



### 3️⃣ Build & Push Docker Images
GitHub Actions workflow builds and pushes images on every push to `main`.  
For manual build:
```

docker build -t <DOCKER_USER>/ingestion-service:latest ./ingestion
docker push <DOCKER_USER>/ingestion-service:latest
```
repeat for api-gateway, analytics, auth, processing, router, frontend


### 4️⃣ Apply Kubernetes Manifests
```
kubectl apply -f k8s/




```


## 📊 Monitoring & Logs

* Logs stored in `ingestion.logs` & `delivery_logs`.
* Retry logic managed via `retry_queue`.
* Analytics service aggregates events for dashboards.




## 🤝 Contributing

Pull requests are welcome! Please open an issue first to discuss major changes.
Make sure to update tests as appropriate.

---

