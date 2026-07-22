import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import Database from "./database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class VPNDatabaseLoader {
  constructor() {
    this.vpnIPs = new Set();
    this.proxyIPs = new Set();
    this.dataCenterIPs = new Set();
    this.dataCenterRanges = [];
    this.dbDir = path.join(__dirname, "../vpn-databases");
    this.db = Database;
    this.ensureDir();
  }

  ensureDir() {
    if (!fs.existsSync(this.dbDir)) {
      fs.mkdirSync(this.dbDir, { recursive: true });
      console.log(`✓ Created database directory: ${this.dbDir}`);
    }
  }

  /**
   * Load only from cached database (startup mode - fast)
   */
  async loadFromCache() {
    console.log("\n📥 Loading cached VPN databases...");
    await this.loadLocalCache();

    console.log(`\n✓ VPN IPs loaded: ${this.vpnIPs.size}`);
    console.log(`✓ Proxy IPs loaded: ${this.proxyIPs.size}`);
    console.log(`✓ Datacenter IPs loaded: ${this.dataCenterIPs.size}`);
    console.log(`✓ Datacenter ranges loaded: ${this.dataCenterRanges.length}`);
  }

  /**
   * Sync from sources (remote download - slow, manual only)
   */
  async syncFromSources() {
    console.log("\n📥 Syncing VPN databases from sources...");

    // Enable bulk import mode for faster inserts
    await this.db.enableBulkImportMode();

    try {
      // Load sequentially to avoid database lock conflicts
      await this.loadFireHOL();
      await this.loadDatacenterSources();
      await this.loadCustomSource();
    } finally {
      // Restore normal mode after bulk import
      await this.db.disableBulkImportMode();
    }

    console.log(`\n✓ VPN IPs loaded: ${this.vpnIPs.size}`);
    console.log(`✓ Proxy IPs loaded: ${this.proxyIPs.size}`);
    console.log(`✓ Datacenter IPs loaded: ${this.dataCenterIPs.size}`);
    console.log(`✓ Datacenter ranges loaded: ${this.dataCenterRanges.length}`);
  }

  /**
   * Load all (backward compatibility - calls syncFromSources)
   */
  async loadAll() {
    await this.syncFromSources();
  }

  /**
   * Load from FireHOL (Best free source)
   */
  async loadFireHOL() {
    const sources = [
      {
        url: "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_anonymous.netset",
        type: "vpn",
        name: "FireHOL Anonymous VPN/Proxy IPs",
      },
      {
        url: "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_proxies.netset",
        type: "proxy",
        name: "FireHOL Proxy IPs",
      },
      {
        url: "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/socks_proxy.ipset",
        type: "proxy",
        name: "FireHOL SOCKS Proxy IPs",
      },
      {
        url: "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/sslproxies.ipset",
        type: "proxy",
        name: "FireHOL SSL Proxy IPs",
      },
      {
        url: "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/tor_exits.ipset",
        type: "proxy",
        name: "FireHOL Tor Exit IPs",
      },
    ];

    // Download all and accumulate by type
    const typeMap = { vpn: new Set(), proxy: new Set(), datacenter: new Set() };
    const typeDownloadCounts = { vpn: 0, proxy: 0, datacenter: 0 };

    for (const source of sources) {
      try {
        console.log(`  ⬇ Downloading ${source.name}...`);
        const response = await fetch(source.url, { timeout: 10000 });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();

        const ips = text
          .split("\n")
          .filter((line) => line && !line.startsWith("#"))
          .map((line) => line.trim())
          .filter((ip) => ip);

        typeDownloadCounts[source.type] += ips.length;
        ips.forEach((ip) => {
          typeMap[source.type].add(ip);
          if (source.type === "vpn") {
            this.vpnIPs.add(ip);
          } else if (source.type === "proxy") {
            this.proxyIPs.add(ip);
          } else if (source.type === "datacenter") {
            this.dataCenterIPs.add(ip);
          }
        });

        console.log(`    ✓ Added ${ips.length} IPs from ${source.name}`);
      } catch (err) {
        console.error(`    ✗ Error loading ${source.name}: ${err.message}`);
        console.log(`    → Falling back to cache...`);
      }
    }

    // Save deduplicated IPs to database by type (after all downloads)
    for (const type of Object.keys(typeMap)) {
      const uniqueIPs = Array.from(typeMap[type]);
      if (uniqueIPs.length > 0) {
        console.log(
          `  💾 Saving ${uniqueIPs.length} unique ${type} IPs (${typeDownloadCounts[type]} total downloaded)...`,
        );
        await this.saveIPsToDatabase(uniqueIPs, type, "FireHOL");
      }
    }
  }

  _isIPv4(ip) {
    return /^\d+\.\d+\.\d+\.\d+$/.test(ip);
  }

  _ipv4ToLong(ip) {
    return (
      ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
    );
  }

  _cidrToRange(cidr) {
    const [ip, prefix] = cidr.split("/");
    const mask = prefix === undefined ? 32 : Number(prefix);
    const address = this._ipv4ToLong(ip);
    const bits = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
    const start = address & bits;
    const end = (start + (mask === 32 ? 0 : (1 << (32 - mask)) - 1)) >>> 0;
    return { start, end };
  }

  _addDatacenterRange(cidr) {
    if (!cidr || !cidr.includes("/")) {
      return;
    }
    try {
      const range = this._cidrToRange(cidr);
      this.dataCenterRanges.push(range);
    } catch {
      // ignore invalid CIDR lines
    }
  }

  async loadDatacenterSources() {
    const sources = [
      {
        url: "https://ip-ranges.amazonaws.com/ip-ranges.json",
        name: "AWS IP ranges",
      },
      {
        url: "https://www.gstatic.com/ipranges/cloud.json",
        name: "Google Cloud IP ranges",
      },
      {
        url: "https://www.cloudflare.com/ips-v4",
        name: "Cloudflare IP ranges",
        isPlainText: true,
      },
    ];

    const cachePath = path.join(this.dbDir, "datacenter.txt");
    fs.writeFileSync(cachePath, "");
    this.dataCenterRanges = [];

    // Accumulate all unique CIDRs in a Set
    const uniqueCidrs = new Set();
    let totalDownloaded = 0;

    for (const source of sources) {
      try {
        console.log(`  ⬇ Downloading ${source.name}...`);
        const response = await fetch(source.url, { timeout: 15000 });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();
        let cidrs = [];

        if (source.isPlainText) {
          cidrs = text
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"));
        } else {
          const data = JSON.parse(text);
          if (data.prefixes) {
            cidrs = data.prefixes
              .map((prefix) => prefix.ip_prefix || prefix.ipv4Prefix)
              .filter(Boolean);
          } else if (data.items) {
            cidrs = data.items
              .map((item) => item.ipv4Prefix || item.ip_prefix)
              .filter(Boolean);
          }
        }

        totalDownloaded += cidrs.length;
        cidrs.forEach((cidr) => {
          uniqueCidrs.add(cidr);
          this._addDatacenterRange(cidr);
        });

        console.log(
          `    ✓ Added ${cidrs.length} datacenter ranges from ${source.name}`,
        );
      } catch (err) {
        console.error(`    ✗ Error loading ${source.name}: ${err.message}`);
        console.log("    → Falling back to cache...");
      }
    }

    // Save deduplicated CIDRs to database (after all downloads)
    const uniqueCidrList = Array.from(uniqueCidrs);
    if (uniqueCidrList.length > 0) {
      console.log(
        `  💾 Saving ${uniqueCidrList.length} unique datacenters (${totalDownloaded} total downloaded)...`,
      );
      await this.saveIPsToDatabase(
        uniqueCidrList,
        "datacenter",
        "Datacenter Ranges",
      );
    }
  }

  /**
   * Load from local cache (offline fallback)
   */
  async loadLocalCache() {
    console.log(`  💾 Loading from database cache...`);
    const types = ["vpn", "proxy", "datacenter"];

    for (const type of types) {
      try {
        const entries = await this.loadIPsFromDatabase(type);
        if (entries.length === 0) continue;

        if (type === "datacenter") {
          entries.forEach((entry) => {
            if (entry.includes("/")) {
              this._addDatacenterRange(entry);
            } else {
              this.dataCenterIPs.add(entry);
            }
          });
        } else if (type === "vpn") {
          entries.forEach((ip) => this.vpnIPs.add(ip));
        } else if (type === "proxy") {
          entries.forEach((ip) => this.proxyIPs.add(ip));
        }

        console.log(
          `    ✓ Loaded ${entries.length} ${type} entries from database cache`,
        );
      } catch (err) {
        console.error(
          `    ✗ Error loading ${type} from database:`,
          err.message,
        );
      }
    }
  }

  /**
   * Save IPs to database cache using a single transaction and prepared statement
   */
  async saveIPsToDatabase(ips, type, source) {
    return new Promise((resolve, reject) => {
      if (!this.db || !this.db.db) {
        resolve();
        return;
      }

      if (ips.length === 0) {
        resolve();
        return;
      }

      console.log(`    📊 Saving ${ips.length} ${type} IPs to database...`);

      const clearSql = "DELETE FROM vpn_ips_cache WHERE type = ?";
      this.db.db.run(clearSql, [type], (clearErr) => {
        if (clearErr) {
          console.error(`    ✗ Error clearing ${type} cache:`, clearErr);
          return resolve();
        }

        this.db.db.serialize(() => {
          this.db.db.run("BEGIN TRANSACTION");

          const insertSql =
            "INSERT OR IGNORE INTO vpn_ips_cache (ip, type, source) VALUES (?, ?, ?)";
          const stmt = this.db.db.prepare(insertSql);
          const total = ips.length;
          let processed = 0;
          const reportStep = Math.max(10000, Math.floor(total / 100));

          ips.forEach((ip) => {
            stmt.run([ip, type, source], (err) => {
              if (err) {
                console.error(`    ! Error inserting ${ip}:`, err.message);
              }
              processed += 1;
              if (processed % reportStep === 0 || processed === total) {
                const percent = ((processed / total) * 100).toFixed(1);
                console.log(
                  `    ⏳ Processed: ${processed.toLocaleString()}/${total.toLocaleString()} (${percent}%)`,
                );
              }
              if (processed === total) {
                stmt.finalize((finalizeErr) => {
                  if (finalizeErr) {
                    console.error(
                      "    ✗ Error finalizing statement:",
                      finalizeErr,
                    );
                    return reject(finalizeErr);
                  }
                  this.db.db.run("COMMIT", (commitErr) => {
                    if (commitErr) {
                      console.error(
                        "    ✗ Transaction commit error:",
                        commitErr,
                      );
                      return reject(commitErr);
                    }
                    console.log(
                      `    ✓ Saved ${total.toLocaleString()} ${type} IPs to database`,
                    );
                    resolve();
                  });
                });
              }
            });
          });
        });
      });
    });
  }

  /**
   * Insert a batch of IPs with retry logic for I/O errors
   */
  async _insertBatch(batch, type, source, retries = 3) {
    return new Promise((resolve, reject) => {
      const attemptInsert = (attempt) => {
        this.db.db.serialize(() => {
          const insertSql =
            "INSERT INTO vpn_ips_cache (ip, type, source) VALUES (?, ?, ?)";
          let completed = 0;
          let hasError = false;
          let errorCount = 0;

          batch.forEach((ip) => {
            this.db.db.run(insertSql, [ip, type, source], (err) => {
              if (err) {
                if (err.code === "SQLITE_IOERR" && attempt < retries) {
                  // Retry on I/O errors (database locked)
                  errorCount++;
                } else {
                  // Log other errors but continue
                  console.error(`    ! Error inserting ${ip}:`, err.message);
                  hasError = true;
                }
              }
              completed++;
              if (completed === batch.length) {
                if (errorCount > 0 && attempt < retries) {
                  // Retry entire batch
                  console.log(
                    `    ⚠ Retrying batch (attempt ${attempt + 1}/${retries})...`,
                  );
                  setTimeout(() => attemptInsert(attempt + 1), 100 * attempt);
                } else if (hasError) {
                  reject(new Error("Batch insert had errors"));
                } else {
                  resolve();
                }
              }
            });
          });
        });
      };
      attemptInsert(1);
    });
  }

  /**
   * Load IPs from database cache
   */
  async loadIPsFromDatabase(type) {
    return new Promise((resolve, reject) => {
      if (!this.db || !this.db.db) {
        resolve([]);
        return;
      }

      const sql = "SELECT ip FROM vpn_ips_cache WHERE type = ? ORDER BY ip";
      this.db.db.all(sql, [type], (err, rows) => {
        if (err) {
          console.error(`Error loading ${type} from database:`, err);
          resolve([]);
        } else {
          resolve((rows || []).map((row) => row.ip));
        }
      });
    });
  }

  /**
   * Load from custom/self-maintained source
   */
  async loadCustomSource() {
    console.log(`  🔧 Loading custom sources...`);
    // Add your own verified IPs here
    const customIPs = {
      vpn: [],
      proxy: [],
      datacenter: [],
    };

    customIPs.vpn.forEach((ip) => this.vpnIPs.add(ip));
    customIPs.proxy.forEach((ip) => this.proxyIPs.add(ip));
    customIPs.datacenter.forEach((ip) => this.dataCenterIPs.add(ip));

    if (customIPs.vpn.length > 0) {
      console.log(`    ✓ Added ${customIPs.vpn.length} custom VPN IPs`);
    }
  }

  /**
   * Check if IP is in VPN/proxy list
   */
  isVPN(ip) {
    return this.vpnIPs.has(ip);
  }

  isProxy(ip) {
    return this.proxyIPs.has(ip);
  }

  isDatacenter(ip) {
    if (this.dataCenterIPs.has(ip)) {
      return true;
    }
    if (!this._isIPv4(ip)) {
      return false;
    }

    const value = this._ipv4ToLong(ip);
    return this.dataCenterRanges.some(
      (range) => value >= range.start && value <= range.end,
    );
  }

  /**
   * Update database periodically
   */
  startAutoUpdate(intervalHours = 24) {
    console.log(`\n⏰ Auto-update scheduled every ${intervalHours} hours`);
    setInterval(
      () => {
        console.log("\n🔄 Auto-updating VPN database...");
        this.loadAll();
      },
      intervalHours * 60 * 60 * 1000,
    );
  }
}

export default new VPNDatabaseLoader();
