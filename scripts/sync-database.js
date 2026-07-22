#!/usr/bin/env node
/**
 * Manual VPN Database Sync Script
 * Run with: node scripts/sync-database.js
 * Or: npm run sync
 */

import Database from "../services/database.js";
import VPNDatabaseLoader from "../services/vpnDatabaseLoader.js";

console.log("🔄 Starting VPN Database Sync...\n");

try {
  // Initialize database
  await Database.initialize();

  // Use shared loader instance exported by vpnDatabaseLoader
  const loader = VPNDatabaseLoader;

  // Sync from sources
  await loader.syncFromSources();

  console.log("\n✅ Sync completed successfully!");
  console.log(
    "📝 Run 'npm start' to restart the service and load updated IPs\n",
  );

  process.exit(0);
} catch (error) {
  console.error("\n❌ Sync failed:", error.message);
  process.exit(1);
}
