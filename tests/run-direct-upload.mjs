import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

async function reservePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}

const dir = await mkdtemp(join(tmpdir(), "coredent-direct-upload-"));
const port = await reservePort();
const stubPort = await reservePort();

const clinicA = {
  id: "direct_upload_clinic_a",
  name: "عيادة أ",
  email: "clinic-a@example.invalid",
  password: "clinic-a-password",
  isActive: true,
  subscriptionExpiresAt: "2030-01-01",
  staffMembers: [
    { id: "staffA1", name: "موظف أ", role: "استقبال", password: "staff-a-password", allowedTabs: ["calendar"] },
  ],
};

await writeFile(
  join(dir, "local_db.json"),
  JSON.stringify({
    clinics: [{ id: clinicA.id, data: JSON.stringify(clinicA) }],
    files: [],
  }),
);

const env = {
  ...process.env,
  NODE_ENV: "production", ALLOW_LOCAL_JSON_DB: '1', 
  PORT: String(port),
  AUTH_SECRET: "isolated-direct-upload-test-secret-only",
  TEST_BASE: `http://127.0.0.1:${port}`,
  TEST_DB_DIR: dir,
  TEST_R2_STUB_PORT: String(stubPort),
  R2_ACCESS_KEY_ID: "direct-upload-test-key",
  R2_SECRET_ACCESS_KEY: "direct-upload-test-secret",
  R2_ENDPOINT: `http://127.0.0.1:${stubPort}`,
  R2_BUCKET_NAME: "test-bucket",
  R2_PUBLIC_URL: `http://127.0.0.1:${stubPort}/pub`,
};
for (const k of [
  "DATABASE_URL", "POSTGRES_URL", "PG_DATABASE_URL", "PGHOST", "DB_HOST",
  "PGUSER", "PGPASSWORD", "DB_PASSWORD", "PGDATABASE", "DB_NAME",
]) delete env[k];

const server = spawn(
  process.execPath,
  [resolve(process.env.TEST_SERVER_BUNDLE || "dist-server/server.cjs")],
  { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] },
);
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
  const test = spawn(process.execPath, [resolve("tests/direct-upload.integration.cjs")], {
    env,
    stdio: "inherit",
  });
  const code = await new Promise((r) => test.on("exit", r));
  if (code !== 0) throw Error("Direct-upload regression failed. " + log);
  console.log("Isolated test database removed. No clinic data was used or changed.");
} finally {
  server.kill();
  await new Promise((r) => server.on("exit", r));
  await rm(dir, { recursive: true, force: true });
}
