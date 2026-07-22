import fs from "fs";
const p = "data/vpn_detection.db";
if (!fs.existsSync(p)) {
  console.log("MISSING");
  process.exit(0);
}
const buf = fs.readFileSync(p, { start: 0, end: 15 });
console.log("header", buf.toString("ascii"));
console.log("size", fs.statSync(p).size);
