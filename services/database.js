import sqlite3 from "sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, "../data/vpn_detection.sql");
    this.db = null;
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      console.log("📊 Initializing database...");

      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error("✗ Database connection failed:", err);
          reject(err);
        } else {
          console.log(`✓ Database connected: ${this.dbPath}`);

          // Enable WAL mode for better concurrent access
          this.db.run("PRAGMA journal_mode = WAL", (err) => {
            if (err) {
              console.warn("⚠ Could not enable WAL mode:", err.message);
            } else {
              console.log("✓ WAL mode enabled for concurrent access");
            }
          });

          // Set timeout for busy database
          this.db.configure("busyTimeout", 5000);

          this.createTables();
          resolve();
        }
      });
    });
  }

  createTables() {
    const schema = `
      CREATE TABLE IF NOT EXISTS visitor_visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        visitor_id TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        country TEXT,
        timezone TEXT,
        is_vpn BOOLEAN DEFAULT 0,
        is_proxy BOOLEAN DEFAULT 0,
        is_datacenter BOOLEAN DEFAULT 0,
        risk_score INTEGER,
        browser_fingerprint TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS vpn_ips_cache (
        ip TEXT PRIMARY KEY,
        type TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        source TEXT
      );

      CREATE TABLE IF NOT EXISTS suspicious_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        visitor_id TEXT NOT NULL,
        pattern_type TEXT,
        description TEXT,
        risk_score INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Indexes for visitor_visits table
      CREATE INDEX IF NOT EXISTS idx_visitor_id ON visitor_visits(visitor_id);
      CREATE INDEX IF NOT EXISTS idx_ip_address ON visitor_visits(ip_address);
      CREATE INDEX IF NOT EXISTS idx_created_at ON visitor_visits(created_at);
      CREATE INDEX IF NOT EXISTS idx_visitor_created ON visitor_visits(visitor_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_risk_score ON visitor_visits(risk_score DESC);
      CREATE INDEX IF NOT EXISTS idx_is_vpn ON visitor_visits(is_vpn);
      CREATE INDEX IF NOT EXISTS idx_is_proxy ON visitor_visits(is_proxy);
      CREATE INDEX IF NOT EXISTS idx_is_datacenter ON visitor_visits(is_datacenter);

      -- Indexes for vpn_ips_cache table
      CREATE INDEX IF NOT EXISTS idx_vpn_type ON vpn_ips_cache(type);
      CREATE INDEX IF NOT EXISTS idx_vpn_source ON vpn_ips_cache(source);
      CREATE INDEX IF NOT EXISTS idx_vpn_added ON vpn_ips_cache(added_at DESC);

      -- Indexes for suspicious_patterns table
      CREATE INDEX IF NOT EXISTS idx_pattern_visitor ON suspicious_patterns(visitor_id);
      CREATE INDEX IF NOT EXISTS idx_pattern_type ON suspicious_patterns(pattern_type);
      CREATE INDEX IF NOT EXISTS idx_pattern_created ON suspicious_patterns(visitor_id, created_at DESC);
    `;

    this.db.exec(schema, (err) => {
      if (err) {
        console.error("✗ Error creating tables:", err);
      } else {
        console.log("✓ Database tables created");
      }
    });
  }

  /**
   * Enable bulk import mode for faster inserts
   */
  async enableBulkImportMode() {
    return new Promise((resolve) => {
      this.db.serialize(() => {
        this.db.run("PRAGMA journal_mode = OFF", () => {
          this.db.run("PRAGMA synchronous = OFF", () => {
            this.db.run("PRAGMA cache_size = -500000", () => {
              this.db.run("PRAGMA temp_store = MEMORY", () => {
                console.log("✓ Bulk import mode enabled");
                resolve();
              });
            });
          });
        });
      });
    });
  }

  /**
   * Disable bulk import mode and restore WAL mode
   */
  async disableBulkImportMode() {
    return new Promise((resolve) => {
      this.db.serialize(() => {
        this.db.run("PRAGMA journal_mode = WAL", () => {
          this.db.run("PRAGMA synchronous = NORMAL", () => {
            this.db.run("PRAGMA cache_size = -50000", () => {
              this.db.run("PRAGMA temp_store = DEFAULT", () => {
                console.log("✓ Bulk import mode disabled");
                resolve();
              });
            });
          });
        });
      });
    });
  }

  /**
   * Record a visitor visit
   */
  recordVisit(visitData) {
    return new Promise((resolve, reject) => {
      const {
        visitorId,
        ip,
        country,
        timezone,
        isVPN,
        isProxy,
        isDatacenter,
        riskScore,
        browserFingerprint,
        userAgent,
      } = visitData;

      const sql = `
        INSERT INTO visitor_visits 
        (visitor_id, ip_address, country, timezone, is_vpn, is_proxy, is_datacenter, risk_score, browser_fingerprint, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(
        sql,
        [
          visitorId,
          ip,
          country,
          timezone,
          isVPN ? 1 : 0,
          isProxy ? 1 : 0,
          isDatacenter ? 1 : 0,
          riskScore,
          browserFingerprint,
          userAgent,
        ],
        function (err) {
          if (err) {
            console.error("Error recording visit:", err);
            reject(err);
          } else {
            resolve({ id: this.lastID });
          }
        },
      );
    });
  }

  /**
   * Get visitor history
   */
  getVisitorHistory(visitorId, limit = 10) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM visitor_visits
        WHERE visitor_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `;

      this.db.all(sql, [visitorId, limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * Get last visit for a visitor
   */
  getLastVisit(visitorId) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM visitor_visits
        WHERE visitor_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `;

      this.db.get(sql, [visitorId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * Record suspicious pattern
   */
  recordSuspiciousPattern(patternData) {
    return new Promise((resolve, reject) => {
      const { visitorId, patternType, description, riskScore } = patternData;

      const sql = `
        INSERT INTO suspicious_patterns
        (visitor_id, pattern_type, description, risk_score)
        VALUES (?, ?, ?, ?)
      `;

      this.db.run(
        sql,
        [visitorId, patternType, description, riskScore],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve({ id: this.lastID });
          }
        },
      );
    });
  }

  /**
   * Get suspicious patterns for visitor
   */
  getSuspiciousPatterns(visitorId) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM suspicious_patterns
        WHERE visitor_id = ?
        ORDER BY created_at DESC
      `;

      this.db.all(sql, [visitorId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * Close database connection
   */
  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

export default new Database();
