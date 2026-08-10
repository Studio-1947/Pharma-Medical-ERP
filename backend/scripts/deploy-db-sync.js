const { Client } = require("pg");

async function syncDeploymentDatabase() {
  const connectionString = process.env.DB_TARGET === "prod" ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL;

  if (!connectionString) {
    console.log("[DB Deployment Sync] Skip: No DATABASE_URL provided.");
    process.exit(0);
  }

  console.log("[DB Deployment Sync] Connecting to database to apply pending schema columns...");
  const client = new Client({ connectionString });

  try {
    await client.connect();

    await client.query(`
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS state VARCHAR(100);
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS gstin VARCHAR(15);
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS drug_license_20b VARCHAR(100);
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS drug_license_21b VARCHAR(100);
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS licensee_name VARCHAR(255);
      ALTER TABLE medicines ADD COLUMN IF NOT EXISTS drawer_mapping VARCHAR(50);
    `);

    console.log("[DB Deployment Sync] ✅ Database schema columns synchronized successfully!");
  } catch (err) {
    console.error("[DB Deployment Sync] ❌ Error syncing schema columns:", err.message);
  } finally {
    await client.end();
  }
}

syncDeploymentDatabase();
