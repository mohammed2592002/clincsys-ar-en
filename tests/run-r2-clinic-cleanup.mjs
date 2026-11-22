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

const dir = await mkdtemp(join(tmpdir(), "coredent-r2-cleanup-"));
const port = await reservePort();
const stubPort = await reservePort();
const pub = `http://127.0.0.1:${stubPort}/pub`;

const clinicA = {
  id: "r2_cleanup_clinic_a",
  name: "عيادة أ",
  email: "clinic-a@example.invalid",
  password: "clinic-a-password",
  isActive: true,
  subscriptionExpiresAt: "2030-01-01",
};
const clinicB = {
  id: "r2_cleanup_clinic_b",
  name: "عيادة ب",
  email: "clinic-b@example.invalid",
  password: "clinic-b-password",
  isActive: true,
  subscriptionExpiresAt: "2030-01-01",
};

// Synthetic fixtures only. Every path points at the local R2 stub, never real R2.
const files = [
  // Two ordinary objects owned by clinic A.
  { path: `${pub}/clinics/${clinicA.id}/xrays/aaa-f1.png`, mimeType: "image/png", data: "", clinicId: clinicA.id },
  { path: `${pub}/clinics/${clinicA.id}/xrays/aaa-f2.png`, mimeType: "image/png", data: "", clinicId: clinicA.id },
  // Owned by clinic A, but the stub is told to fail its first deletion attempt.
  { path: `${pub}/clinics/${clinicA.id}/xrays/aaa-fail-me.png`, mimeType: "image/png", data: "", clinicId: clinicA.id },
  // Tampered row: registered under clinic A but the key lives under clinic B's
  // prefix. Ownership must be rejected and this object must never be deleted.
  { path: `${pub}/clinics/${clinicB.id}/xrays/bbb-stolen.png`, mimeType: "image/png", data: "", clinicId: clinicA.id },
  // Local-disk fallback file: not an R2 object, must be ignored.
  { path: `/uploads/local-xray.png`, mimeType: "image/png", data: "", clinicId: clinicA.id },
  // Clinic B's own object: must never be touched by clinic A's cleanup.
  { path: `${pub}/clinics/${clinicB.id}/xrays/bbb-f1.png`, mimeType: "image/png", data: "", clinicId: clinicB.id },
];

await writeFile(
  join(dir, "local_db.json"),
  JSON.stringify({
    clinics: [
      { id: clinicA.id, data: JSON.stringify(clinicA) },
      { id: clinicB.id, data: JSON.stringify(clinicB) },
    ],
    files,
  }),
);

const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(port),
  AUTH_SECRET: "isolated-r2-cleanup-test-secret-only",
  TEST_BASE: `http://127.0.0.1:${port}`,
  TEST_DB_DIR: dir,
  TEST_R2_STUB_PORT: String(stubPort),
  TEST_CLINIC_A: clinicA.id,
  TEST_CLINIC_B: clinicB.id,
  R2_ACCESS_KEY_ID: "r2-cleanup-test-key",
  R2_SECRET_ACCESS_KEY: "r2-cleanup-test-secret",
  R2_ENDPOINT: `http://127.0.0.1:${stubPort}`,
  R2_BUCKET_NAME: "test-bucket",
  R2_PUBLIC_URL: pub,
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
  const test = spawn(process.execPath, [resolve("tests/r2-clinic-cleanup.integration.cjs")], {
    env,
    stdio: "inherit",
  });
  const code = await new Promise((r) => test.on("exit", r));
  if (code !== 0) throw Error("R2 clinic cleanup regression failed. " + log);
  console.log("Isolated test database removed. No clinic data was used or changed.");
} finally {
  server.kill();
  await new Promise((r) => server.on("exit", r));
  await rm(dir, { recursive: true, force: true });
}
