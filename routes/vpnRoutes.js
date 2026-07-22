import express from "express";
import VPNDetector from "../services/vpnDetection.js";
import Database from "../services/database.js";

const router = express.Router();

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === "string"
      ? forwarded.split(",")[0].trim()
      : req.socket.remoteAddress;

  if (!ip) {
    return null;
  }

  return ip.replace(/^::ffff:/, "");
}

router.get("/check-vpn", async (req, res) => {
  const ip = getClientIp(req);
  const { visitorId, browserFingerprint, userAgent, browserSignals } =
    req.body || {};
  console.log("Visitor ID:", visitorId);

  if (!ip) {
    return res.status(400).json({ error: "Unable to determine client IP" });
  }

  try {
    const ipResult = await VPNDetector.checkIP(ip);
    const history = visitorId
      ? await Database.getVisitorHistory(visitorId, 10)
      : [];
    const patternResult = await VPNDetector.checkVisitorPatterns({
      visitorId: visitorId || "unknown",
      currentIP: ip,
      previousVisits: history,
      browserFingerprint,
      browserSignals,
    });

    await Database.recordVisit({
      visitorId: visitorId || "unknown",
      ip,
      country: ipResult.country,
      timezone: ipResult.timezone,
      isVPN: ipResult.isVPN,
      isProxy: ipResult.isProxy,
      isDatacenter: ipResult.isDatacenter,
      riskScore: ipResult.riskScore,
      browserFingerprint: browserFingerprint || null,
      userAgent: userAgent || req.headers["user-agent"] || null,
    });

    if (patternResult.patterns.length > 0) {
      for (const description of patternResult.patterns) {
        await Database.recordSuspiciousPattern({
          visitorId: visitorId || "unknown",
          patternType: "vpn-pattern",
          description,
          riskScore: patternResult.riskScore,
        });
      }
    }

    return res.json({
      ...ipResult,
      patterns: patternResult.patterns,
      patternRiskScore: patternResult.riskScore,
      finalRecommendation: patternResult.recommendation,
      visitorId: visitorId || "unknown",
    });
  } catch (err) {
    console.error("check-vpn error:", err);
    return res.status(500).json({ error: "VPN check failed" });
  }
});

export default router;
