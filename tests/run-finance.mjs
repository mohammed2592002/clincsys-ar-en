import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
const dir = await mkdtemp(join(tmpdir(), "coredent-finance-"));
const reserve = net.createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const clinic = {
  id: "finance_isolated_test",
  name: "عيادة الاختبار المحلي",
  doctorName: "دكتور الاختبار",
  email: "finance-isolated@example.invalid",
  password: "test-only-password",
  isActive: true,
  subscriptionExpiresAt: "2030-01-01",
  loyaltyProgramEnabled: true,
  loyaltyEarnEgpThreshold: 100,
  loyaltyEarnPoints: 20,
  loyaltyRedeemPointsThreshold: 100,
  loyaltyRedeemDiscountEgp: 100,
  staffMembers: [
    {
      id: "staff1",
      name: "موظف الاختبار",
      role: "استقبال",
      password: "test-staff-only",
      allowedTabs: ["calendar"],
    },
  ],
};
await writeFile(
  join(dir, "local_db.json"),
  JSON.stringify({
    clinics: [{ id: clinic.id, data: JSON.stringify(clinic) }],
  }),
);
const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(port),
  AUTH_SECRET: "isolated-finance-test-secret-only",
  TEST_BASE: `http://127.0.0.1:${port}`,
};
for (const k of [
  "DATABASE_URL",
  "POSTGRES_URL",
  "PG_DATABASE_URL",
  "PGHOST",
  "DB_HOST",
  "PGUSER",
  "PGPASSWORD",
  "DB_PASSWORD",
  "PGDATABASE",
  "DB_NAME",
])
  delete env[k];
const server = spawn(process.execPath, [resolve(process.env.TEST_SERVER_BUNDLE || "dist-server/server.cjs")], {
  cwd: dir,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(env.TEST_BASE);
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!ready) throw Error("Test server failed to start. " + log);
  const test = spawn(
    process.execPath,
    [resolve("tests/finance.integration.cjs")],
    { env, stdio: "inherit" },
  );
  const code = await new Promise((r) => test.on("exit", r));
  if (code !== 0) throw Error("Finance regression failed. " + log);
  if (process.env.TEST_OFFLINE === "1" || process.env.TEST_LIVE_BUGS === "1") {
    const bundle = join(dir, "offline-client.js");
    const build = spawn(
      resolve("node_modules/.bin/esbuild"),
      [
        process.env.TEST_CLIENT_ENTRY || (process.env.TEST_LIVE_BUGS ? "tests/live-bugs-client.ts" : "src/dbClient.ts"),
        "--bundle",
        "--platform=browser",
        "--format=iife",
        "--global-name=OfflineAudit",
        "--outfile=" + bundle,
      ],
      { env, stdio: "inherit" },
    );
    if ((await new Promise((r) => build.on("exit", r))) !== 0)
      throw Error("Offline client build failed");
    const testOffline = spawn(
      process.execPath,
      [resolve(process.env.TEST_LIVE_BUGS ? "tests/live-bugs.integration.cjs" : "tests/offline.integration.cjs")],
      { env: { ...env, OFFLINE_TEST_BUNDLE: bundle }, stdio: "inherit" },
    );
    if ((await new Promise((r) => testOffline.on("exit", r))) !== 0)
      throw Error("Offline integration failed");
  }
  if (process.env.TEST_UI === "1") {
    const ui = spawn(process.execPath, [resolve("tests/finance.ui.cjs")], {
      env,
      stdio: "inherit",
    });
    if ((await new Promise((r) => ui.on("exit", r))) !== 0)
      throw Error("Finance UI regression failed");
  }
  console.log(
    "Isolated test database removed. No clinic data was used or changed.",
  );
} finally {
  server.kill();
  await new Promise((r) => server.on("exit", r));
  await rm(dir, { recursive: true, force: true });
}
