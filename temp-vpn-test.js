import loader from "./services/vpnDatabaseLoader.js";

async function run() {
  await loader.loadAll();
  console.log(
    "VPN",
    loader.vpnIPs.size,
    "Proxy",
    loader.proxyIPs.size,
    "DataCenterIPs",
    loader.dataCenterIPs.size,
    "DataCenterRanges",
    loader.dataCenterRanges.length,
  );
  console.log("Datacenter test 8.8.8.8", loader.isDatacenter("8.8.8.8"));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
