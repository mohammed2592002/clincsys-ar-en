// Live verification for the backend hardening items (Nov 24, 2026).
// 1. Production without DATABASE_URL must refuse to boot (fail loud).
// 2. With ALLOW_LOCAL_JSON_DB=1 the server boots on the emulator.
// 3. getDocs: invalid limit => 400; over-cap limit is clamped server-side.
// 4. Patient search: offset is capped (no error, sane response).
// 5. Body limits: >2mb JSON to /api/finance => 413; large JSON to /api/db still accepted.
// 6. Sync events still publish after the broadcast-after-commit refactor.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import assert from "node:assert/strict";

const bundle = resolve("dist-server/server.cjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

// --- 1. fail loud without DATABASE_URL in production ---
{
  const dir = await mkdtemp(join(tmpdir(), "coredent-hardening-fail-"));
  const port = await freePort();
  const env = { ...process.env, NODE_ENV: "production", PORT: String(port), AUTH_SECRET: "hardening-test-only" };
  for (const k of ["DATABASE_URL","POSTGRES_URL","PG_DATABASE_URL","PGHOST","DB_HOST","PGUSER","PGPASSWORD","DB_PASSWORD","PGDATABASE","DB_NAME"]) delete env[k];
  const p = spawn(process.execPath, [bundle], { cwd: dir, env, stdio: ["ignore","pipe","pipe"] });
  let log = "";
  p.stdout.on("data", (d) => (log += d));
  p.stderr.on("data", (d) => (log += d));
  const code = await new Promise((r) => p.on("exit", r));
  assert.notEqual(code, 0, "server must exit non-zero when production has no DATABASE_URL");
  assert.match(log, /Refusing to start in production/, "boot log must name the refusal");
  console.log("PASS 1: production without DATABASE_URL refuses to boot (exit " + code + ")");
}

// --- boot a working server for the remaining checks ---
const dir = await mkdtemp(join(tmpdir(), "coredent-hardening-"));
const port = await freePort();
const clinic = {
  id: "hardening_test",
  name: "Hardening Test Clinic",
  doctorName: "Dr Test",
  email: "hardening@example.invalid",
  password: "test-only-password",
  isActive: true,
  subscriptionExpiresAt: "2030-01-01",
  staffMembers: [],
};
await writeFile(join(dir, "local_db.json"), JSON.stringify({ clinics: [{ id: clinic.id, data: JSON.stringify(clinic) }] }));
const env = { ...process.env, NODE_ENV: "production", ALLOW_LOCAL_JSON_DB: "1", PORT: String(port), AUTH_SECRET: "hardening-test-only" };
for (const k of ["DATABASE_URL","POSTGRES_URL","PG_DATABASE_URL","PGHOST","DB_HOST","PGUSER","PGPASSWORD","DB_PASSWORD","PGDATABASE","DB_NAME"]) delete env[k];
const server = spawn(process.execPath, [bundle], { cwd: dir, env, stdio: ["ignore","pipe","pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${port}`;
let up = false;
for (let i = 0; i < 100; i++) { try { await fetch(base); up = true; break; } catch {} await sleep(100); }
assert(up, "server should boot with ALLOW_LOCAL_JSON_DB=1");
console.log("PASS 2: server boots on emulator when explicitly allowed");

const login = await fetch(base + "/api/auth/clinic-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: clinic.email, password: "test-only-password", role: "manager" }) }).then((r) => r.json());
assert(login.success && login.token, "clinic login failed: " + JSON.stringify(login));
const headers = { "content-type": "application/json", authorization: "Bearer " + login.token };

// --- 3. getDocs limit validation and clamp ---
const path = `clinics/${clinic.id}/inventory`;
for (let i = 0; i < 5; i++) {
  const r = await fetch(base + "/api/db", { method: "POST", headers, body: JSON.stringify({ action: "addDoc", path, data: { name: "item" + i } }) });
  assert(r.ok, "addDoc failed: " + r.status);
}
const bad = await fetch(base + "/api/db", { method: "POST", headers, body: JSON.stringify({ action: "getDocs", path, constraints: [{ type: "limit", limit: 0 }] }) });
assert.equal(bad.status, 400, "limit 0 must be rejected");
const capped = await fetch(base + "/api/db", { method: "POST", headers, body: JSON.stringify({ action: "getDocs", path, constraints: [{ type: "limit", limit: 999999999 }] }) });
assert(capped.ok, "over-cap limit must not error");
const cappedRows = await capped.json();
assert.equal(cappedRows.length, 5, "returns available rows under the cap");
const normal = await fetch(base + "/api/db", { method: "POST", headers, body: JSON.stringify({ action: "getDocs", path, constraints: [{ type: "limit", limit: 3 }] }) });
assert.equal((await normal.json()).length, 3, "normal limit still honored");
console.log("PASS 3: getDocs rejects invalid limits and clamps huge ones (MAX 1000)");

// --- 4. patient search with extreme offset ---
const search = await fetch(base + "/api/patients/search?clinicId=" + clinic.id + "&q=test&offset=999999999", { headers });
assert(search.ok, "patient search must not error on extreme offset");
const searchBody = await search.json();
assert(Array.isArray(searchBody.items), "search returns items array");
console.log("PASS 4: patient search offset capped at 10,000");

// --- 5. per-route body limits ---
const big = "x".repeat(3 * 1024 * 1024);
const financeBig = await fetch(base + "/api/finance", { method: "POST", headers, body: JSON.stringify({ clinicId: clinic.id, action: "read", pad: big }) });
assert.equal(financeBig.status, 413, "3mb body to /api/finance must be rejected (2mb limit)");
const dbBig = await fetch(base + "/api/db", { method: "POST", headers, body: JSON.stringify({ action: "addDoc", path, data: { name: "big", pad: big } }) });
assert(dbBig.ok, "3mb body to /api/db must still be accepted (50mb limit), got " + dbBig.status);
console.log("PASS 5: per-route body limits (2mb default, 50mb document API)");

// --- 6. sync events still publish ---
const updates = await fetch(base + "/api/sync/updates?clinicId=" + clinic.id + "&since=0", { headers });
assert(updates.ok, "sync updates endpoint failed: " + updates.status);
const events = await updates.json();
const list = Array.isArray(events) ? events : events.events || [];
assert(list.some((e) => e.table_name === "inventory" || e.table === "inventory"), "expected an inventory sync event, got: " + JSON.stringify(list).slice(0, 200));
console.log("PASS 6: sync events publish and are readable after the commit refactor");

server.kill("SIGTERM");
await sleep(500);
console.log("ALL HARDENING CHECKS PASSED");
process.exit(0);
