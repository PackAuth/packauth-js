#!/usr/bin/env node
/**
 * packauth — the command line for the PackAuth API.
 *
 * Commands are DERIVED from spec/registries/api.json, the same registry the
 * Worker binds its routes to and the SDK builds its methods from. There is no
 * hand-written command table, so a CLI that lags the API is not a thing that
 * can happen here.
 *
 *   packauth ops                            list every operation
 *   packauth health                         a public call, no token needed
 *   packauth list-packs
 *   packauth get-pack --pack-id gcc_pack
 *   packauth create-run --body '{"manifest_id":"man_01"}'
 *   packauth manifest-matrix --manifest-id man_01 --json
 *
 * The token comes from PACKAUTH_TOKEN, or --token. It is never a positional
 * argument: positional secrets end up in shell history and in `ps` output.
 */
import { PackAuth, PackAuthError, methodName } from "../src/client.mjs";
import api from "../api.json" with { type: "json" };

const argv = process.argv.slice(2);
const BOLD = "[1m";
const DIM = "[2m";
const OFF = "[0m";
const tty = process.stdout.isTTY;
const b = (s) => (tty ? BOLD + s + OFF : s);
const d = (s) => (tty ? DIM + s + OFF : s);

/** command name for an operation: list_packs → list-packs */
const commandName = (operationId) => operationId.replace(/_/g, "-");
const COMMANDS = new Map(api.operations.map((o) => [commandName(o.operation_id), o]));

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    if (key === "json" || key === "help") { out[key] = true; continue; }
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      fail(`--${key} needs a value`);
    }
    out[key.replace(/-/g, "_")] = next;
    i++;
  }
  return out;
}

function fail(msg, code = 1) {
  console.error(`packauth: ${msg}`);
  process.exit(code);
}

function usage() {
  console.log(`${b("packauth")} — the PackAuth API from the command line

${b("Usage")}
  packauth <command> [--flag value] [--json]

${b("Auth")}
  PACKAUTH_TOKEN=<token>   or   --token <token>
  ${d("Three commands are public and need no token: " +
     api.operations.filter((o) => o.public).map((o) => commandName(o.operation_id)).join(", "))}

${b("Commands")}   ${d(`${api.operations.length} operations, derived from spec/registries/api.json`)}
`);
  const width = Math.max(...[...COMMANDS.keys()].map((k) => k.length));
  for (const [name, op] of COMMANDS) {
    const flags = op.path_params.map((p) => `--${p.replace(/_/g, "-")}`).join(" ");
    console.log(`  ${name.padEnd(width)}  ${d(op.method.padEnd(4))} ${op.summary}`);
    if (flags) console.log(`  ${" ".repeat(width)}  ${d("needs " + flags)}`);
  }
  console.log(`
${b("Examples")}
  packauth health
  packauth list-packs
  packauth get-pack --pack-id gcc_pack
  packauth manifest-matrix --manifest-id man_01HX7Q2T --json
  packauth create-run --body '{"manifest_id":"man_01HX7Q2T"}'
`);
}

function opsTable() {
  const rows = api.operations.map((o) => ({
    command: commandName(o.operation_id),
    method: methodName(o.operation_id),
    http: `${o.method} ${o.path}`,
    auth: o.public ? "public" : o.scope,
  }));
  const w = (k) => Math.max(...rows.map((r) => String(r[k]).length), k.length);
  const cols = ["command", "method", "http", "auth"];
  console.log(cols.map((c) => b(c.padEnd(w(c)))).join("  "));
  for (const r of rows) console.log(cols.map((c) => String(r[c]).padEnd(w(c))).join("  "));
}

async function main() {
  const flags = parseFlags(argv);
  const cmd = flags._[0];

  if (!cmd || flags.help || cmd === "help") return usage();
  if (cmd === "ops") return opsTable();

  const op = COMMANDS.get(cmd);
  if (!op) {
    const near = [...COMMANDS.keys()].filter((k) => k.includes(cmd) || cmd.includes(k.split("-")[0]));
    fail(`no command '${cmd}'${near.length ? `. Did you mean: ${near.slice(0, 4).join(", ")}?` : ". Run `packauth help`."}`);
  }

  const token = flags.token ?? process.env.PACKAUTH_TOKEN ?? null;
  const baseUrl = flags.base_url ?? process.env.PACKAUTH_API_URL ?? undefined;

  let body;
  if (flags.body !== undefined) {
    try {
      body = JSON.parse(flags.body);
    } catch {
      fail(`--body is not valid JSON`);
    }
  }

  const args = { ...(body !== undefined ? { body } : {}) };
  for (const p of op.path_params) {
    if (flags[p] === undefined) {
      fail(`${cmd} needs --${p.replace(/_/g, "-")} (it is part of ${op.path})`);
    }
    args[p] = flags[p];
  }

  const pa = new PackAuth({ token, ...(baseUrl ? { baseUrl } : {}) });
  try {
    const result = await pa.call(op.operation_id, args);
    console.log(JSON.stringify(result, null, flags.json ? 0 : 2));
  } catch (e) {
    if (e instanceof PackAuthError) {
      // Exit codes are meaningful: 2 for a caller mistake, 3 for a rejection by
      // the API, 4 for not reaching it. A script can branch on those; it cannot
      // branch on a stack trace.
      const kind = ["no_token", "missing_path_param", "unknown_operation"].includes(e.code)
        ? 2
        : e.code === "unreachable" || e.code === "timeout"
          ? 4
          : 3;
      console.error(`packauth: ${e.message}${e.requestId ? d(`  (request ${e.requestId})`) : ""}`);
      if (e.code) console.error(d(`  code: ${e.code}${e.status ? `  http: ${e.status}` : ""}`));
      process.exit(kind);
    }
    throw e;
  }
}

main().catch((e) => fail(e.message, 1));
