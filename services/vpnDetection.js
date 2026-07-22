import VPNDatabaseLoader from "./vpnDatabaseLoader.js";
import geoip from "geoip-lite";

class VPNDetector {
  constructor() {
    this.loader = VPNDatabaseLoader;
  }

  async initialize() {
    console.log("🚀 Initializing VPN Detector (loading from cache)...");
    await this.loader.loadFromCache();
  }

  /**
   * Main function to check if an IP is using VPN/Proxy
   */
  async checkIP(ip) {
    if (!ip) {
      return {
        error: "IP address required",
        vpnDetected: false,
        riskScore: 0,
      };
    }

    try {
      const isVPN = this.loader.isVPN(ip);
      const isProxy = this.loader.isProxy(ip);
      const isDatacenter = this.loader.isDatacenter(ip);
      const geo = geoip.lookup(ip);

      let riskScore = 0;
      const reasons = [];

      if (isVPN) {
        riskScore += 100;
        reasons.push("IP in known VPN list");
      }
      if (isProxy) {
        riskScore += 80;
        reasons.push("IP in known proxy list");
      }
      if (isDatacenter) {
        riskScore += 60;
        reasons.push("IP is from datacenter/hosting provider");
      }

      return {
        ip,
        isVPN,
        isProxy,
        isDatacenter,
        country: geo?.country || "Unknown",
        timezone: geo?.timezone || "Unknown",
        riskScore: Math.min(riskScore, 100),
        vpnDetected: isVPN || isProxy,
        reasons,
        recommendation: Math.min(riskScore, 100) >= 70 ? "BLOCK" : "ALLOW",
      };
    } catch (err) {
      console.error("Error checking IP:", err);
      return {
        error: err.message,
        vpnDetected: false,
        riskScore: 0,
      };
    }
  }

  /**
   * Check patterns across multiple visits
   */
  async checkVisitorPatterns(visitorData) {
    const { visitorId, currentIP, previousVisits, browserFingerprint } =
      visitorData;

    let riskScore = 0;
    const patterns = [];

    // Check for impossible travel
    if (previousVisits && previousVisits.length > 0) {
      const lastVisit = previousVisits[0];
      const timeDiffMs = Date.now() - new Date(lastVisit.timestamp).getTime();
      const timeDiffHours = timeDiffMs / (1000 * 60 * 60);

      if (timeDiffHours < 2) {
        const lastGeo = geoip.lookup(lastVisit.ip);
        const currentGeo = geoip.lookup(currentIP);

        if (lastGeo && currentGeo && lastGeo.country !== currentGeo.country) {
          riskScore += 40;
          patterns.push(
            `Impossible travel: ${lastGeo.country} → ${currentGeo.country} in ${timeDiffHours.toFixed(1)} hours`,
          );
        }
      }
    }

    // Check for fingerprint rotation (VPN hopping)
    if (previousVisits && previousVisits.length > 2) {
      const uniqueIPs = new Set(previousVisits.map((v) => v.ip));
      const daysActive =
        (Date.now() -
          new Date(
            previousVisits[previousVisits.length - 1].timestamp,
          ).getTime()) /
        (1000 * 60 * 60 * 24);

      if (uniqueIPs.size > 5 && daysActive < 7) {
        riskScore += 30;
        patterns.push(
          `VPN hopping: ${uniqueIPs.size} different IPs in ${daysActive.toFixed(1)} days`,
        );
      }
    }

    return {
      visitorId,
      riskScore: Math.min(riskScore, 100),
      patterns,
      recommendation: riskScore >= 60 ? "BLOCK" : "ALLOW",
    };
  }

  /**
   * Start auto-update of databases
   */
  startAutoUpdate(intervalHours = 24) {
    this.loader.startAutoUpdate(intervalHours);
  }
}

export default new VPNDetector();
