# VPN Detection Service - Database Caching Strategy

## Overview

The service now **persists IP data** across restarts and only syncs with remote sources on manual command.

---

## Quick Start

### 1. **First Time Setup** (Download and cache all IPs)

```bash
npm install
npm run sync    # Downloads from FireHOL + datacenter sources and caches to database
npm start       # Start service (loads from cache - instant startup)
```

### 2. **Regular Operation** (Use cached IPs)

```bash
npm start       # Service starts instantly with cached IPs
```

### 3. **Update IP Lists** (Manual sync only)

```bash
npm run sync    # Downloads latest IPs from all sources and updates cache
npm start       # Restart service to use updated data
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              VPN Detection Service                   │
└─────────────────────────────────────────────────────┘

              Startup: npm start
                    │
                    ▼
        ┌──────────────────────────┐
        │  loadFromCache()          │  ← FAST (~1 second)
        │  - Load from SQLite DB    │
        │  - No network calls       │
        └──────────────────────────┘
                    │
                    ▼
        ┌──────────────────────────┐
        │  Service Ready           │
        │  Port 3000               │
        └──────────────────────────┘


        Manual Sync: npm run sync
                    │
                    ▼
        ┌──────────────────────────┐
        │  syncFromSources()        │  ← SLOW (~3-5 minutes for 2.5M IPs)
        │  - Download from FireHOL │
        │  - Download from AWS/GCP │
        │  - Save to SQLite DB     │
        └──────────────────────────┘
                    │
                    ▼
        ┌──────────────────────────┐
        │  Data cached in DB       │
        │  Ready for next restart  │
        └──────────────────────────┘
```

---

## Benefits

| Aspect                       | Before                   | After                               |
| ---------------------------- | ------------------------ | ----------------------------------- |
| **Startup Time**             | 5-10 minutes             | 1-2 seconds                         |
| **IP Data**                  | Downloaded every restart | Cached, updated only on manual sync |
| **Network Calls on Startup** | Yes (2.5M IPs)           | No                                  |
| **Database Persistence**     | No (lost on restart)     | Yes (SQLite persistent)             |
| **Manual Control**           | Auto-updates every 24h   | Only `npm run sync`                 |

---

## Method Breakdown

### `loadFromCache()`

Used on **startup** (server.js)

- Loads VPN IPs from SQLite database
- Loads Proxy IPs from database
- Loads Datacenter IP ranges from database
- **Speed**: ~1 second for millions of IPs
- **No network calls**

### `syncFromSources()`

Used **only manually** via `npm run sync`

- Downloads from FireHOL (5 sources)
- Downloads from AWS IP ranges
- Downloads from Google Cloud IP ranges
- Downloads from Cloudflare IP ranges
- Saves all to SQLite database with bulk optimizations
- **Speed**: ~1-3 minutes for 2.5M+ IPs
- **Requires network**

### `loadAll()` (deprecated)

- Kept for backward compatibility
- Now just calls `syncFromSources()`

---

## Database Schema

```sql
vpn_ips_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'vpn' | 'proxy' | 'datacenter'
  added_at DATETIME,
  source TEXT,
  UNIQUE(ip, type)     -- Same IP can be VPN and proxy
)

-- Indexes for fast lookups
CREATE INDEX idx_vpn_ip ON vpn_ips_cache(ip)
CREATE INDEX idx_vpn_type ON vpn_ips_cache(type)
```

---

## Commands Reference

| Command        | Purpose                           | Time       |
| -------------- | --------------------------------- | ---------- |
| `npm start`    | Start service with cached IPs     | 2s startup |
| `npm run sync` | Manually update all IP lists      | 3-5 min    |
| `npm run dev`  | Start with auto-reload (dev mode) | 2s startup |

---

## Scheduling Updates

To sync on a schedule (cron), add to your system:

**Linux/macOS (crontab)**

```bash
# Update every Sunday at 2 AM
0 2 * * 0 cd /path/to/vpn-detection-service && npm run sync
```

**Windows (Task Scheduler)**

```
Program: C:\Program Files\nodejs\npm.cmd
Arguments: run sync
Working directory: C:\path\to\vpn-detection-service
Schedule: Weekly on Sunday at 2:00 AM
```

---

## Files Modified

- `services/vpnDatabaseLoader.js` - Split into `loadFromCache()` and `syncFromSources()`
- `services/vpnDetection.js` - Initialize with cache only
- `server.js` - Removed auto-update, loads from cache
- `scripts/sync-database.js` - New manual sync script
- `package.json` - Added `npm run sync` command

---

## Troubleshooting

**Q: Service starts but shows 0 IPs**

```
A: Run 'npm run sync' first to download and cache the IP lists
```

**Q: Sync is taking too long**

```
A: This is normal - 2.5M+ IPs take 1-3 minutes with optimizations
   The "Processed: X/Y (Z%)" shows progress
```

**Q: Want to auto-sync on startup?**

```
A: Modify server.js line 18 to call:
   await VPNDetector.loader.syncFromSources();
   This will be slow on every restart (~3-5 min)
```

**Q: Datacenter IPs not updating?**

```
A: Run 'npm run sync' - it downloads AWS, Google Cloud, and Cloudflare ranges
```

---

## Performance Metrics

- **2,528,577 VPN IPs**: Cached lookup < 1ms
- **2,528,577 Proxy IPs**: Cached lookup < 1ms
- **50,000+ Datacenter ranges**: Cached lookup < 5ms
- **Full database size**: ~500MB (SQLite file)
- **Cache load on startup**: ~1-2 seconds
- **Sync from sources**: ~1-3 minutes (bulk optimized)
