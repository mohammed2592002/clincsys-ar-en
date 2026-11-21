import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

const dir = await mkdtemp(join(tmpdir(), "coredent-file-access-"));
const reserve = net.createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));

const clinicA = {
  id: "file_access_clinic_a",
  name: "عيادة أ",
  email: "clinic-a@example.invalid",
  password: "clinic-a-password",
  isActive: true,
  subscriptionExpiresAt: "2030-01-01",
  staffMembers: [
    { id: "staffA1", name: "موظف أ", role: "استقبال", password: "staff-a-password", allowedTabs: ["calendar"] },
  ],
};
const clinicB = {
  id: "file_access_clinic_b",
  name: "عيادة ب",
  email: "clinic-b@example.invalid",
  password: "clinic-b-password",
  isActive: true,
  subscriptionExpiresAt: "2030-01-01",
  staffMembers: [
    { id: "staffB1", name: "موظف ب", role: "استقبال", password: "staff-b-password", allowedTabs: ["calendar"] },
  ],
};

// Legacy fixtures from before per-clinic ownership existed: one file on disk
// and one stored as base64 in the files table, both without a clinicId.
const legacyPng = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f030005fe02fea72d994d0000000049454e44ae426082",
  "hex",
);
await mkdir(join(dir, "uploads"), { recursive: true });
await writeFile(join(dir, "uploads", "legacy_disk_xray.png"), legacyPng);

await writeFile(
  join(dir, "local_db.json"),
  JSON.stringify({
    clinics: [
      { id: clinicA.id, data: JSON.stringify(clinicA) },
      { id: clinicB.id, data: JSON.stringify(clinicB) },
    ],
    files: [
      { path: "legacy_disk_xray.png", mimeType: "image/png", data: "" },
      { path: "legacy_db_xray.png", mimeType: "image/png", data: legacyPng.toString("base64") },
    ],
  }),
);

const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(port),
  AUTH_SECRET: "isolated-file-access-test-secret-only",
  TEST_BASE: `http://127.0.0.1:${port}`,
  TEST_LEGACY_PNG_B64: legacyPng.toString("base64"),
};
for (const k of [
  "DATABASE_URL", "POSTGRES_URL", "PG_DATABASE_URL", "PGHOST", "DB_HOST",
  "PGUSER", "PGPASSWORD", "DB_PASSWORD", "PGDATABASE", "DB_NAME",
  "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_BUCKET_NAME", "R2_PUBLIC_URL",
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
  const test = spawn(process.execPath, [resolve("tests/file-access.integration.cjs")], {
    env,
    stdio: "inherit",
  });
  const code = await new Promise((r) => test.on("exit", r));
  if (code !== 0) throw Error("File-access regression failed. " + log);
  console.log("Isolated test database removed. No clinic data was used or changed.");
} finally {
  server.kill();
  await new Promise((r) => server.on("exit", r));
  await rm(dir, { recursive: true, force: true });
}
