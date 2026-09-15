import express from "express";
import cors from "cors";
import VPNDetector from "./services/vpnDetection.js";
import Database from "./services/database.js";
import vpnRoutes from "./routes/vpnRoutes.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

console.log("Initializing VPN Detection Service...");
await Database.initialize();
await VPNDetector.initialize();

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
  console.log(`✓ VPN Detection Service running`);
});
