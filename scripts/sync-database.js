import Database from "../services/database.js";
import VPNDatabaseLoader from "../services/vpnDatabaseLoader.js";

try {
  await Database.initialize();

  const loader = VPNDatabaseLoader;
  await loader.syncFromSources();
  
  process.exit(0);
} catch (error) {
  console.error("\nSync failed:", error.message);
  process.exit(1);
}
