import VPNDatabaseLoader from "../services/vpnDatabaseLoader.js";

async function run() {
  console.log("Updating VPN database cache...");
  await VPNDatabaseLoader.loadAll();
  console.log("Update complete.");
}

run().catch((err) => {
  console.error("Database update failed:", err);
  process.exit(1);
});
