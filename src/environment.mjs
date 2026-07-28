/**
 * The environment contract, in one place.
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * There were four names for two concepts. The credential was
 * `PACKAUTH_TOKEN` in both SDKs, the CLI, the README and the published org
 * profile — and `PACKAUTH_API_KEY` in the smoke test and the corpus MCP
 * server. The base URL was `PACKAUTH_API_URL` in the SDKs, `PACKAUTH_API_BASE`
 * in the MCP server, and `PACKAUTH_BASE` in the sandbox page's own copy-paste
 * snippet.
 *
 * On its own that is untidy. The day the sandbox shipped it became a hazard,
 * because an unset base URL does not fail — it falls back to production. A
 * developer who read the sandbox page, exported the name it printed, and ran
 * the CLI was talking to PRODUCTION while believing every write was
 * disposable. The calls succeed. The responses look right. The only signal is
 * rows appearing in a database they thought they were nowhere near.
 *
 * So: one name per concept, deprecated names REFUSED rather than honoured or
 * ignored, and a plane check that costs nothing.
 *
 * THE PLANE CHECK
 *
 * A key says which plane it belongs to — `pa_live_` or `pa_test_` — and a host
 * says which plane it serves. When they disagree the request is refused before
 * it is sent. The server would refuse it anyway with a 401, but a 401 reads as
 * "bad credential" and sends somebody looking for a typo in their key; this
 * says what actually happened.
 */
// `../environment.json`, the copy this package carries — not the canon two
// directories up. The published client has to work when it is extracted from
// this repository, and reaching for the repo's registry only resolves while it
// is still inside it. The copy is generated and drift-checked by
// scripts/build-openapi.mjs, exactly as sdk/api.json is, so it is a projection
// of the registry rather than a second declaration of it.
import env from "../environment.json" with { type: "json" };

const VAR = new Map(env.variables.map((v) => [v.name, v]));
const PLANES = env.plane_prefixes;

export class EnvironmentError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "EnvironmentError";
    this.code = code ?? "environment_error";
  }
}

/**
 * Read one declared variable, refusing a deprecated name rather than
 * honouring it. Silently accepting an alias is how two names for one thing
 * stay alive; silently IGNORING one is how a developer ends up on the wrong
 * plane while staring at the export they just typed.
 */
export function read(name, source = process.env) {
  const spec = VAR.get(name);
  if (!spec) throw new EnvironmentError(`'${name}' is not declared in spec/registries/environment.json`);

  const set = spec.aliases.filter((a) => source[a]);
  if (!source[name] && set.length) {
    throw new EnvironmentError(
      `${set.join(" and ")} ${set.length === 1 ? "is" : "are"} set, and PackAuth reads ${name}. ` +
        `The old name is refused rather than honoured: two names for one setting means one of them ` +
        `is the one that silently does nothing. Export ${name}=… instead.`,
      { code: "deprecated_env_name" }
    );
  }
  return source[name] ?? spec.default ?? null;
}

/** Which plane a key belongs to, from its prefix. Null for an unrecognised shape. */
export function planeOfKey(key) {
  return PLANES.find((p) => String(key ?? "").startsWith(p.key_prefix))?.plane ?? null;
}

/** Which plane a base URL serves. Null when it is neither known host. */
export function planeOfUrl(url) {
  const host = (() => {
    try {
      return new URL(String(url)).hostname;
    } catch {
      return String(url ?? "");
    }
  })();
  return PLANES.find((p) => host === p.host_suffix)?.plane ?? null;
}

/**
 * Resolve the credential and the base URL together, and refuse a mismatch.
 *
 * Returning them as a pair is the point. Read separately they are two settings
 * that happen to be nearby; read together they are one decision — which
 * PackAuth am I talking to, as which tenant — and that decision can be wrong
 * in exactly one way worth catching.
 */
export function resolve(source = process.env) {
  const token = read("PACKAUTH_TOKEN", source);
  const baseUrl = read("PACKAUTH_API_URL", source);

  const keyPlane = planeOfKey(token);
  const urlPlane = planeOfUrl(baseUrl);

  if (token && keyPlane && urlPlane && keyPlane !== urlPlane) {
    throw new EnvironmentError(
      `the key is a ${keyPlane} key (${PLANES.find((p) => p.plane === keyPlane).key_prefix}…) and ` +
        `${baseUrl} is the ${urlPlane} plane. This would be refused as an invalid credential, which ` +
        `reads as a typo — it is not. Point PACKAUTH_API_URL at the ${keyPlane} host, or use a ` +
        `${urlPlane} key.`,
      { code: "plane_mismatch" }
    );
  }

  return { token, baseUrl, plane: urlPlane ?? keyPlane ?? "production" };
}
