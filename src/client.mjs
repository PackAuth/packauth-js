/**
 * PackAuth SDK — the client for the PackAuth API.
 *
 * Every method is DERIVED from spec/registries/api.json at construction time.
 * That is the whole design: an SDK whose method list is written by hand is a
 * second declaration of the API surface, and the second one falls behind. Here
 * there is nothing to fall behind — add an operation to the registry and the
 * client has the method, remove one and calling it is a TypeError rather than a
 * 404 discovered in production.
 *
 *   import { PackAuth } from "@packauth/sdk";
 *
 *   const pa = new PackAuth({ token: process.env.PACKAUTH_TOKEN });
 *   const { data } = await pa.listPacks();
 *   const run = await pa.createRun({ body: { manifest_id: "man_01HX" } });
 *   const matrix = await pa.manifestMatrix({ manifest_id: "man_01HX" });
 *
 * Path parameters are named, never positional. `getPack({ pack_id })` reads at
 * the call site; `getPack("gcc_pack")` does not, and a two-parameter version of
 * it is a bug waiting for the day someone swaps the arguments.
 */

import api from "../api.json" with { type: "json" };

const DEFAULT_BASE = "https://api.packauth.com";

/** snake_case operation_id → camelCase method name. */
export function methodName(operationId) {
  return operationId.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

export class PackAuthError extends Error {
  constructor(message, { status, code, requestId, body } = {}) {
    super(message);
    this.name = "PackAuthError";
    this.status = status ?? null;
    this.code = code ?? "packauth_error";
    this.requestId = requestId ?? null;
    this.body = body ?? null;
  }
}

/** Substitute :name segments. A missing one is an error, never an empty path. */
function buildPath(op, params) {
  return op.path.replace(/:([a-z_]+)/g, (_, name) => {
    const v = params?.[name];
    if (v === undefined || v === null || v === "") {
      throw new PackAuthError(
        `${methodName(op.operation_id)}() needs '${name}' — it is part of the path ${op.path}`,
        { code: "missing_path_param" }
      );
    }
    return encodeURIComponent(String(v));
  });
}

export class PackAuth {
  /**
   * @param {object} opts
   * @param {string} [opts.token]   Bearer token. Required for every operation
   *                                except the three declared public.
   * @param {string} [opts.baseUrl] Defaults to the production API.
   * @param {number} [opts.timeoutMs]
   * @param {typeof fetch} [opts.fetch] Injected for tests; defaults to global.
   */
  constructor({ token, baseUrl = DEFAULT_BASE, timeoutMs = 30000, fetch: fetchImpl } = {}) {
    this.token = token ?? null;
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl ?? globalThis.fetch;
    if (typeof this.fetch !== "function") {
      throw new PackAuthError("no fetch available — pass one via { fetch }", { code: "no_fetch" });
    }

    this.operations = new Map(api.operations.map((o) => [o.operation_id, o]));

    // Bind one method per declared operation.
    for (const op of api.operations) {
      const name = methodName(op.operation_id);
      if (this[name]) {
        throw new PackAuthError(`operation '${op.operation_id}' collides with '${name}'`, {
          code: "operation_collision",
        });
      }
      this[name] = (args = {}) => this.call(op.operation_id, args);
    }
  }

  /** Which operations exist, and what each needs. Useful for a CLI or a REPL. */
  describe() {
    return api.operations.map((o) => ({
      method_name: methodName(o.operation_id),
      operation_id: o.operation_id,
      http: `${o.method} ${o.path}`,
      scope: o.scope,
      public: o.public,
      path_params: o.path_params,
      summary: o.summary,
    }));
  }

  /**
   * Invoke an operation by id. Every generated method routes through here, so
   * there is one place where auth, timeout and error shape are decided.
   *
   * @param {string} operationId
   * @param {{query?: object, body?: object, signal?: AbortSignal, [param: string]: any}} args
   */
  async call(operationId, args = {}) {
    const op = this.operations.get(operationId);
    if (!op) {
      throw new PackAuthError(`no operation '${operationId}'`, { code: "unknown_operation" });
    }
    if (!op.public && !this.token) {
      throw new PackAuthError(
        `${methodName(operationId)}() requires a token — it is scoped '${op.scope}'`,
        { code: "no_token" }
      );
    }

    const { query, body, signal, ...params } = args;
    const url = new URL(this.baseUrl + buildPath(op, params));
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers = { accept: "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    // The caller's signal wins; the timeout is a floor, not an override.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });

    let res;
    try {
      res = await this.fetch(url.toString(), {
        method: op.method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      throw new PackAuthError(`${methodName(operationId)}() could not reach ${this.baseUrl}`, {
        code: controller.signal.aborted ? "timeout" : "unreachable",
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    if (!res.ok) {
      // The API's own error shape is { error: { code, message }, request_id }.
      // Surfacing the request_id matters more than the message: it is what
      // makes a support conversation about a specific call possible.
      const err = payload?.error ?? {};
      throw new PackAuthError(err.message ?? `HTTP ${res.status}`, {
        status: res.status,
        code: err.code ?? `http_${res.status}`,
        requestId: payload?.request_id ?? res.headers.get("x-request-id"),
        body: payload,
      });
    }
    return payload;
  }
}

export default PackAuth;
