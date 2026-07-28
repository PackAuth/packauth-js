/**
 * The environment contract, tested where the guarantee actually lives.
 *
 * `environment-canonical` proves nothing in the repository READS a deprecated
 * name. It cannot prove the resolver still REFUSES one, because a deprecated
 * name with no remaining uses is invisible to a static scan — mutation-testing
 * the gate by deleting an alias from the registry produced no detectable
 * change, which is the honest result and the reason this file exists.
 *
 * The hazard is not a stale reference in the codebase. It is a developer with
 * `PACKAUTH_API_KEY` exported from six months ago, who reads the current docs,
 * changes nothing, and gets silence — the old name ignored, the new one unset,
 * and the base URL quietly defaulting to production.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { resolve, read, planeOfKey, planeOfUrl, EnvironmentError } from "../src/environment.mjs";

/*
 * `../environment.json` — the copy this package carries, which is what the
 * module under test reads. Reaching for the repository's registry passed here
 * and failed the moment the client was extracted, which is precisely the
 * portability the published package has to have: build-org runs these tests
 * from dist/sdk-js/ alone for exactly this reason.
 */
const registry = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "environment.json"), "utf8")
);

/*
 * PINNED AS LITERALS, deliberately, in a repository where a literal is almost
 * always the wrong answer.
 *
 * The first version of this test read the alias list out of the registry — and
 * so proved nothing. Deleting `PACKAUTH_API_KEY` from the registry left the
 * test with nothing to look for and it passed, which is the mutation it was
 * written to catch. A test that takes its expectations from the thing it is
 * testing moves whenever that thing moves.
 *
 * These are HISTORICAL FACTS. These names once worked, somebody's shell profile
 * still exports one, and that will be true whatever the registry says next
 * year. Removing one from this list has to be a deliberate edit here, arguing
 * that nobody could still have it set.
 */
const ONCE_WORKED = [
  ["PACKAUTH_API_KEY", "PACKAUTH_TOKEN"],
  ["PACKAUTH_API_BASE", "PACKAUTH_API_URL"],
  ["PACKAUTH_BASE", "PACKAUTH_API_URL"],
];

test("every name that once worked is refused, not honoured and not ignored", () => {
  for (const [alias, canonical] of ONCE_WORKED) {
    assert.throws(
      () => read(canonical, { [alias]: "something" }),
      (e) => e instanceof EnvironmentError && e.code === "deprecated_env_name" && e.message.includes(canonical),
      `${alias} was not refused in favour of ${canonical} — somebody with it exported gets silence`
    );
  }
});

test("the registry still declares every name that once worked", () => {
  // The other direction: the resolver refuses what the registry lists, so a
  // name dropped from the registry stops being refused. This is what makes the
  // pinned list above load-bearing rather than decorative.
  const declared = new Map(registry.variables.flatMap((v) => v.aliases.map((a) => [a, v.name])));
  for (const [alias, canonical] of ONCE_WORKED) {
    assert.equal(
      declared.get(alias),
      canonical,
      `${alias} is no longer declared as an alias of ${canonical}, so nothing refuses it any more`
    );
  }
});

test("the canonical name wins when both are set", () => {
  assert.equal(read("PACKAUTH_TOKEN", { PACKAUTH_TOKEN: "canonical", PACKAUTH_API_KEY: "old" }), "canonical");
});

test("an unset optional variable falls back to its declared default", () => {
  assert.equal(read("PACKAUTH_API_URL", {}), "https://api.packauth.com");
});

test("a sandbox key against the production default is refused before the request", () => {
  // The exact hazard the sandbox created: the base URL has a default, so
  // forgetting to set it does not fail — it silently means production.
  assert.throws(
    () => resolve({ PACKAUTH_TOKEN: "pa_test_abc" }),
    (e) => e.code === "plane_mismatch" && /sandbox key/.test(e.message)
  );
});

test("a production key against the sandbox host is refused too", () => {
  assert.throws(
    () => resolve({ PACKAUTH_TOKEN: "pa_live_abc", PACKAUTH_API_URL: "https://sandbox.packauth.com" }),
    (e) => e.code === "plane_mismatch"
  );
});

test("a matched pair resolves, and reports which plane it is on", () => {
  assert.deepEqual(resolve({ PACKAUTH_TOKEN: "pa_live_abc" }), {
    token: "pa_live_abc",
    baseUrl: "https://api.packauth.com",
    plane: "production",
  });
  assert.equal(
    resolve({ PACKAUTH_TOKEN: "pa_test_abc", PACKAUTH_API_URL: "https://sandbox.packauth.com" }).plane,
    "sandbox"
  );
});

test("an unrecognised host or key shape is not guessed at", () => {
  // A self-hosted deployment or a key from a future scheme must not be blocked
  // by a check that only knows two hostnames. Unknown means no opinion, not a
  // refusal — refusing what it does not understand would make the guard the
  // thing people work around.
  assert.equal(planeOfUrl("https://packauth.internal.example"), null);
  assert.equal(planeOfKey("something_else"), null);
  assert.equal(
    resolve({ PACKAUTH_TOKEN: "pa_test_abc", PACKAUTH_API_URL: "http://localhost:8787" }).plane,
    "sandbox",
    "with an unknown host the key's own plane is the best available answer"
  );
});

test("every variable the registry declares can be read without throwing", () => {
  for (const v of registry.variables) {
    assert.doesNotThrow(() => read(v.name, {}), `${v.name} is declared and unreadable`);
  }
});

test("reading an undeclared name is an error, not a silent null", () => {
  assert.throws(() => read("PACKAUTH_INVENTED", {}), /not declared/);
});
