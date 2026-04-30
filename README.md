# Pharma-Medical ERP

A modern Enterprise Resource Planning (ERP) system for Pharmacies and Medical stores, built with Next.js, NestJS, and Drizzle ORM.

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v20 or later
- **pnpm**: v9 or later
- **Docker & Docker Compose**: For database and infrastructure services

### 🛠️ Initial Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Initialize environment variables:**
   This script generates RSA keys for JWT and creates your `.env` file from `.env.example`.
   ```bash
   node setup.js
   ```

3. **Start infrastructure services:**
   This starts Postgres, Redis, Minio, and Elasticsearch in the background.
   ```bash
   docker compose up -d
   ```

4. **Initialize the database:**
   Sync the database schema and (optionally) seed it with initial data.
   ```bash
   pnpm run db:push
   pnpm run db:seed # Optional: add dummy data
   ```

---

## 🐳 Infrastructure Stack (Docker)

If you're new to Docker, here's what just started running:

| Service | Purpose |
| :--- | :--- |
| **PostgreSQL** | Primary database for sales, inventory, and users. |
| **Redis** | High-speed cache for sessions and atomic invoice numbers. |
| **Elasticsearch** | Powerful search engine for medicine catalogs. |
| **MinIO** | Local file storage (S3 compatible) for prescriptions and images. |

### 🛠️ Docker Cheat Sheet
| Command | Result |
| :--- | :--- |
| `docker ps` | Check if services are running and healthy. |
| `docker compose logs -f` | View live logs/errors from services. |
| `docker compose stop` | Pause services without losing data. |
| `docker compose down` | Stop and **remove** containers (data persists in volumes). |

---

## 💻 Development

### Run Everything (Frontend + Backend)
Uses Turborepo to start both development servers concurrently.
```bash
pnpm run dev
```

### Individual Services
If you want to run only one part of the stack:
- **Backend only:** `pnpm --filter backend run dev` (Port 4000)
- **Frontend only:** `pnpm --filter frontend run dev` (Port 3000)

---

## 🗄️ Database Management (Drizzle)

We use a dual-database setup to ensure local development doesn't interfere with production.

### 🌐 Environments & Configuration
The system switches databases based on environment variables found in your `.env` files:

*   **Local (Default)**: Uses `DATABASE_URL` (points to Docker container on port 5433).
*   **Production**: Uses `DATABASE_URL_PROD` (points to Neon DB).

The switching logic is handled automatically in `backend/drizzle.config.ts` via the `DB_TARGET` flag.

### 🛠️ Syncing Commands

| Target | Command | Description |
| :--- | :--- | :--- |
| **Local** | `pnpm run db:push` | Directly push schema changes to Local Docker. |
| **Local** | `pnpm run db:migrate` | Apply versioned migrations to Local Docker. |
| **Prod** | `pnpm run db:push:prod` | Directly push schema changes to **Neon DB**. |
| **Prod** | `pnpm run db:migrate:prod` | Apply versioned migrations to **Neon DB**. |

### 🚀 Recommended Safe Workflow

1.  **Modify Schema**: Edit your Drizzle schema files in `backend/src/database/schema/`.
2.  **Test Locally**: Run `pnpm run db:push` to update your local Docker database.
3.  **Generate Migration**: Once happy, run `pnpm run db:generate` to create a permanent migration file.
4.  **Go Live**: 
    *   Run `pnpm run db:migrate` (Local) to test the migration script.
    *   Run `pnpm run db:migrate:prod` to apply the same changes to the Neon production database.

> [!CAUTION]
> Avoid using `db:push:prod` for production if you have critical data. It's better to use versioned migrations (`db:migrate:prod`) to ensure a predictable and reversible update path.

---

## 🏗️ Other Commands

- **Build all packages:** `pnpm run build`
- **Lint code:** `pnpm run lint`
- **Type check:** `pnpm run typecheck`
- **Run tests:** `pnpm run test`

---

## 📁 Project Structure

- `backend/`: NestJS API with Fastify and Drizzle ORM.
- `frontend/`: Next.js application with Tailwind CSS and TanStack Query.
- `packages/`: Shared TypeScript configurations and type definitions.
- `docker-compose.yml`: Infrastructure configuration (Postgres, Redis, Minio, ES).
