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
   Starts Postgres, Redis, Minio, and Elasticsearch.
   ```bash
   docker-compose up -d
   ```

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

All database commands should be run from the root using these shortcuts:

| Command | Description |
| :--- | :--- |
| `pnpm run db:generate` | Generate migration files based on schema changes. |
| `pnpm run db:migrate` | Apply pending migrations to the database. |
| `pnpm run db:push` | Directly sync schema changes (useful for local dev). |
| `pnpm run db:studio` | Open Drizzle Studio to browse your data visually. |

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
