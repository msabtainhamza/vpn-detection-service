import express from "express";
import cors from "cors";
import VPNDetector from "./services/vpnDetection.js";
import Database from "./services/database.js";
import vpnRoutes from "./routes/vpnRoutes.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize services
console.log("Initializing VPN Detection Service...");
await Database.initialize();
await VPNDetector.initialize();

// Note: Use 'npm run sync' to manually update IP lists from sources
// Do not use startAutoUpdate() - sync only on manual command

// Routes
app.use("/api", vpnRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    vpnIPs: VPNDetector.loader.vpnIPs.size,
    proxyIPs: VPNDetector.loader.proxyIPs.size,
    dataCenterIPs: VPNDetector.loader.dataCenterIPs.size,
  });
});

app.listen(PORT, () => {
  console.log(`✓ VPN Detection Service running on http://localhost:${PORT}`);
  console.log(`✓ Health check: http://localhost:${PORT}/health`);
  console.log(
    `✓ VPN Check endpoint: POST http://localhost:${PORT}/api/check-vpn`,
  );
});
