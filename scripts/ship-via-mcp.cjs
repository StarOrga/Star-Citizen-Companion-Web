#!/usr/bin/env node
/**
 * ship-via-mcp — call a tool of the devops plugin's ship MCP server from a fresh
 * process, when the session's own copy of that server is gone.
 *
 * Why: merges in this repo go ONLY through `ship_release`. The plugin
 * auto-updates in place and deletes the previous cache directory, so every
 * session that started on the previous version loses its `dotclaude-ship`
 * server ("Connection closed") and `reconnect` re-dials the deleted path
 * (2026-09-17: a routine run could not merge for that reason). The server
 * itself still works from the NEW cache directory — this script starts it
 * there over stdio and forwards one tool call. Same server, same rules,
 * same result JSON.
 *
 *   node scripts/ship-via-mcp.cjs <tool> <args.json> [--root <plugin-cache-dir>]
 *   node scripts/ship-via-mcp.cjs ship_release ship.json
 *
 * <args.json> holds the tool's arguments exactly as the MCP tool takes them
 * (title, body, cwd, tag, skipChecks …). Without --root the newest version
 * under ~/.claude/plugins/cache/dotclaude/devops/ is used. Exit 0 on a tool
 * result, 1 when the tool reported an error, 2 when the call itself failed.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const argv = process.argv.slice(2);
const flagIx = argv.indexOf('--root');
const explicitRoot = flagIx >= 0 ? argv.splice(flagIx, 2)[1] : null;
const [tool, argsFile] = argv;
if (!tool || !argsFile) {
  console.error('usage: node scripts/ship-via-mcp.cjs <tool> <args.json> [--root <plugin-cache-dir>]');
  process.exitCode = 2;
} else {
  main().catch((e) => { console.error(`[ship-via-mcp] ${e.message}`); process.exitCode = 2; });
}

function newestPluginRoot() {
  const base = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'plugins', 'cache', 'dotclaude', 'devops');
  if (!fs.existsSync(base)) throw new Error(`no devops plugin cache at ${base}`);
  const semver = (v) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const versions = fs.readdirSync(base).filter((d) => /^\d+\.\d+\.\d+$/.test(d) && fs.existsSync(path.join(base, d, 'mcp-server', 'ship', 'index.js')));
  if (!versions.length) throw new Error(`no ship server under ${base}`);
  versions.sort((a, b) => { const [x, y] = [semver(a), semver(b)]; return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]); });
  return path.join(base, versions[versions.length - 1]);
}

async function main() {
  const root = explicitRoot ? path.resolve(explicitRoot) : newestPluginRoot();
  const sdk = path.join(root, 'mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs');
  const { Client } = require(path.join(sdk, 'client', 'index.js'));
  const { StdioClientTransport } = require(path.join(sdk, 'client', 'stdio.js'));
  const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
  console.error(`[ship-via-mcp] ${tool} via ${root}`);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'mcp-server', 'ship', 'index.js')],
    cwd: root,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'ship-via-mcp', version: '1.0.0' });
  await client.connect(transport);
  try {
    const res = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 15 * 60 * 1000 });
    for (const c of res.content || []) if (c.type === 'text') console.log(c.text);
    process.exitCode = res.isError ? 1 : 0;
  } finally {
    await client.close();
  }
}
