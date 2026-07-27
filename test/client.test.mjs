import { test } from "node:test";
import assert from "node:assert/strict";

import { PackAuth, PackAuthError, methodName } from "../src/client.mjs";
import api from "../api.json" with { type: "json" };

const TOKEN = "pat_test";

/** A fetch stand-in that records the request and returns what the test wants. */
function stubFetch({ status = 200, json = {}, headers = {} } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      text: async () => JSON.stringify(json),
    };
  };
  fn.calls = calls;
  return fn;
}

const client = (opts = {}) => new PackAuth({ token: TOKEN, baseUrl: "https://api.test", fetch: stubFetch(), ...opts });

test("every declared operation becomes a method, and nothing else does", () => {
  const pa = client();
  for (const op of api.operations) {
    assert.equal(typeof pa[methodName(op.operation_id)], "function", `missing ${op.operation_id}`);
  }
  assert.equal(pa.describe().length, api.operations.length);
});

test("operation_id maps to camelCase predictably", () => {
  assert.equal(methodName("list_packs"), "listPacks");
  assert.equal(methodName("manifest_matrix"), "manifestMatrix");
  assert.equal(methodName("health"), "health");
  assert.equal(methodName("create_print_release"), "createPrintRelease");
});

test("path parameters are substituted and url-encoded", async () => {
  const f = stubFetch({ json: { pack_id: "gcc_pack" } });
  const pa = new PackAuth({ token: TOKEN, baseUrl: "https://api.test", fetch: f });
  await pa.getPack({ pack_id: "gcc pack/1" });
  assert.equal(f.calls[0].url, "https://api.test/v1/packs/gcc%20pack%2F1");
});

test("a missing path parameter fails at the call site, not as a 404", async () => {
  const pa = client();
  await assert.rejects(
    () => pa.getPack({}),
    (e) => e instanceof PackAuthError && e.code === "missing_path_param" && /pack_id/.test(e.message)
  );
});

test("a scoped operation without a token fails before any request is made", async () => {
  const f = stubFetch();
  const pa = new PackAuth({ baseUrl: "https://api.test", fetch: f });
  await assert.rejects(
    () => pa.listPacks(),
    (e) => e instanceof PackAuthError && e.code === "no_token"
  );
  assert.equal(f.calls.length, 0, "a request was sent without a token");
});

test("a public operation works with no token at all", async () => {
  const f = stubFetch({ json: { status: "healthy" } });
  const pa = new PackAuth({ baseUrl: "https://api.test", fetch: f });
  const r = await pa.health();
  assert.equal(r.status, "healthy");
  assert.equal(f.calls[0].init.headers.authorization, undefined);
});

test("the token is sent as a bearer header on scoped calls", async () => {
  const f = stubFetch({ json: {} });
  const pa = new PackAuth({ token: TOKEN, baseUrl: "https://api.test", fetch: f });
  await pa.listPacks();
  assert.equal(f.calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
});

test("a body is JSON-encoded and typed", async () => {
  const f = stubFetch({ json: {} });
  const pa = new PackAuth({ token: TOKEN, baseUrl: "https://api.test", fetch: f });
  await pa.createRun({ body: { manifest_id: "man_01" } });
  assert.equal(f.calls[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { manifest_id: "man_01" });
});

test("query parameters are appended, and empty ones are dropped", async () => {
  const f = stubFetch({ json: {} });
  const pa = new PackAuth({ token: TOKEN, baseUrl: "https://api.test", fetch: f });
  await pa.listFindings({ query: { severity: "blocking", state: null, limit: 10 } });
  const u = new URL(f.calls[0].url);
  assert.equal(u.searchParams.get("severity"), "blocking");
  assert.equal(u.searchParams.get("limit"), "10");
  assert.equal(u.searchParams.has("state"), false);
});

test("an API error surfaces its code and request id, not just a status", async () => {
  const f = stubFetch({
    status: 409,
    json: { error: { code: "manifest_state_invalid", message: "cannot release from draft" }, request_id: "req_01" },
  });
  const pa = new PackAuth({ token: TOKEN, baseUrl: "https://api.test", fetch: f });
  await assert.rejects(
    () => pa.createPrintRelease({ body: {} }),
    (e) =>
      e instanceof PackAuthError &&
      e.status === 409 &&
      e.code === "manifest_state_invalid" &&
      e.requestId === "req_01" &&
      /cannot release from draft/.test(e.message)
  );
});

test("an unreachable API is an error, never a silent null", async () => {
  const pa = new PackAuth({
    token: TOKEN, baseUrl: "https://api.test",
    fetch: async () => { throw new Error("ECONNREFUSED"); },
  });
  await assert.rejects(
    () => pa.listPacks(),
    (e) => e instanceof PackAuthError && e.code === "unreachable"
  );
});

test("an unknown operation id is rejected by name", async () => {
  const pa = client();
  await assert.rejects(
    () => pa.call("no_such_operation", {}),
    (e) => e instanceof PackAuthError && e.code === "unknown_operation"
  );
});

test("describe() reports scope and public honestly for every operation", () => {
  const pa = client();
  const d = pa.describe();
  const pub = d.filter((x) => x.public);
  assert.equal(pub.length, api.operations.filter((o) => o.public).length);
  for (const row of d) {
    assert.ok(row.summary && row.summary.length > 10, `${row.operation_id} has no useful summary`);
    if (!row.public) assert.ok(row.scope, `${row.operation_id} is neither public nor scoped`);
  }
});

test("no two operations collide on a method name", () => {
  const names = api.operations.map((o) => methodName(o.operation_id));
  assert.equal(new Set(names).size, names.length);
});
