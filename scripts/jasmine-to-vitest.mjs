/**
 * Jasmine → Vitest, format-preserving: the transformers of Angular's
 * `refactor-jasmine-vitest` schematic, but only the nodes they change are
 * rewritten.
 *
 * Why not the schematic itself: it prints the WHOLE file back through the
 * TypeScript printer — 4-space indent, every hand-wrapped import collapsed onto
 * one line, every one-line `if` split in two. Run over `src/`, that was a
 * 78 000-line diff for ~7 000 real changes (Vitest pilot, 2026-11-08), and the
 * project's 2-space style (.editorconfig) would be gone for good.
 *
 * Here the schematic's own transformers run unchanged; each outermost node
 * they replace is printed on its own and spliced back into the original text
 * at the node's own position and indentation. Everything else stays byte for
 * byte. A migration tool: it reads the schematic's internals and is meant to
 * be deleted with Karma once every wave has landed.
 *
 *   node scripts/jasmine-to-vitest.mjs [--fake-async] [--dry-run] <file|dir>...
 *
 * --fake-async  also rewrite zone `fakeAsync`/`tick`/`flush` to `vi` fake
 *               timers (the schematic's option of the same name). Default:
 *               leave them; they run under Vitest with zone's Vitest patch.
 * --dry-run     report what would change, write nothing.
 *
 * Prints one line per changed file and every TODO the schematic left in it.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const base = '@schematics/angular/refactor/jasmine-vitest';
const t = (name) => require(`${base}/transformers/${name}`);
const fakeAsyncFlush = t('fake-async-flush');
const fakeAsyncFlushMicrotasks = t('fake-async-flush-microtasks');
const fakeAsyncTest = t('fake-async-test');
const fakeAsyncTick = t('fake-async-tick');
const lifecycle = t('jasmine-lifecycle');
const matcher = t('jasmine-matcher');
const misc = t('jasmine-misc');
const spy = t('jasmine-spy');
const types = t('jasmine-type');
const astHelpers = require(`${base}/utils/ast-helpers`);
const { RefactorReporter } = require(`${base}/utils/refactor-reporter`);

// Same order as the schematic's test-file-transformer.js (22.2.x).
const CALL = [
  matcher.transformWithContext,
  matcher.transformExpectAsync,
  lifecycle.transformFocusedAndSkippedTests,
  lifecycle.transformPending,
  lifecycle.transformDoneCallback,
  matcher.transformSyntacticSugarMatchers,
  matcher.transformComplexMatchers,
  spy.transformSpies,
  spy.transformCreateSpy,
  spy.transformCreateSpyObj,
  spy.transformSpyReset,
  spy.transformSpyCallInspection,
  matcher.transformToHaveBeenCalledBefore,
  // transformToHaveClass is skipped: browser mode has its own toHaveClass.
  matcher.transformToBeNullish,
  fakeAsyncTest.transformFakeAsyncTest,
  fakeAsyncTick.transformFakeAsyncTick,
  fakeAsyncFlush.transformFakeAsyncFlush,
  fakeAsyncFlushMicrotasks.transformFakeAsyncFlushMicrotasks,
  misc.transformFail,
  misc.transformTimerMocks,
  misc.transformUnsupportedGlobalFunctions,
  misc.transformUnsupportedJasmineCalls,
  // Ours, after the schematic's (concept 20261108-2224-vitest-migration, d-matchers).
  containEqual,
];
const FAKE_ASYNC = new Set([
  fakeAsyncTest.transformFakeAsyncTest,
  fakeAsyncTick.transformFakeAsyncTick,
  fakeAsyncFlush.transformFakeAsyncFlush,
  fakeAsyncFlushMicrotasks.transformFakeAsyncFlushMicrotasks,
]);
const PROPERTY = [matcher.transformAsymmetricMatchers, spy.transformSpyCallInspection, misc.transformUnknownJasmineProperties];
const STATEMENT = [
  matcher.transformCalledOnceWith,
  matcher.transformArrayWithExactContents,
  matcher.transformExpectNothing,
  misc.transformJasmineMembers,
];

/**
 * Jasmine's `toContain` compares by deep equality, Vitest's by reference: an
 * object or array literal (or an asymmetric matcher) that Jasmine found in an
 * array is never `toContain`ed under Vitest. `toContainEqual` is Jasmine's
 * meaning. An identifier argument is left alone — it may well be the same
 * reference, and only the types could tell.
 */
function containEqual(node) {
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'toContain') return node;
  if (node.arguments.length !== 1 || !isValueShaped(node.arguments[0])) return node;
  if (!isExpectChain(node.expression.expression)) return node;
  return ts.factory.updateCallExpression(
    node,
    ts.factory.updatePropertyAccessExpression(node.expression, node.expression.expression, ts.factory.createIdentifier('toContainEqual')),
    node.typeArguments,
    node.arguments,
  );
}

function isValueShaped(arg) {
  if (ts.isObjectLiteralExpression(arg) || ts.isArrayLiteralExpression(arg)) return true;
  // jasmine.objectContaining(…) / expect.objectContaining(…) and friends
  return ts.isCallExpression(arg) && ts.isPropertyAccessExpression(arg.expression) && ts.isIdentifier(arg.expression.expression) && ['jasmine', 'expect'].includes(arg.expression.expression.text);
}

/** `expect(x)` or `expect(x).not` */
function isExpectChain(e) {
  if (ts.isPropertyAccessExpression(e) && e.name.text === 'not') e = e.expression;
  return ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'expect';
}

/**
 * Text-level follow-ups on what the schematic prints (d-matchers):
 * - `mock.lastCall` is `T | undefined` in Vitest's types, where Jasmine's
 *   `calls.mostRecent()` was not: assert it.
 * - Jasmine's `and.resolveTo()` without a value becomes `mockResolvedValue()`,
 *   which Vitest's types refuse: pass `undefined`.
 * - A bare Jasmine `spyOn` returns `undefined`; the schematic writes
 *   `mockReturnValue(undefined)`, which does not compile where the method
 *   returns something else (a Promise, a Window): `undefined as never`.
 */
function followUps(text) {
  return text
    .replace(/\.mock\.lastCall(?![!?\w])/g, '.mock.lastCall!')
    .replace(/\.mockResolvedValue\(\)/g, '.mockResolvedValue(undefined)')
    .replace(/\.mockReturnValue\(undefined\)/g, '.mockReturnValue(undefined as never)');
}

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

// Brackets around source text the printer copies through untouched (see print()).
const OPEN = '\u0001';
const CLOSE = '\u0002';

/** Rewrite one file's text; returns the new text (=== input when nothing changed). */
export function migrate(fileName, content, { fakeAsync = false, reporter = new RefactorReporter(silentLogger()) } = {}) {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const original = new Set();
  const collect = (node) => {
    original.add(node);
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const replaced = new Map(); // original node → final node (or node array)
  const ctx = {
    sourceFile,
    reporter,
    pendingVitestValueImports: new Set(),
    pendingVitestTypeImports: new Set(),
    pendingImportSpecifierRemovals: new Map(),
  };
  const calls = fakeAsync ? CALL : CALL.filter((fn) => !FAKE_ASYNC.has(fn));

  const transformer = (context) => {
    ctx.tsContext = context;
    const visitor = (node) => {
      let next = node;
      if (ts.isCallExpression(next)) {
        for (const fn of calls) next = fn(next, ctx);
      } else if (ts.isPropertyAccessExpression(next)) {
        for (const fn of PROPERTY) next = fn(next, ctx);
      } else if (ts.isExpressionStatement(next)) {
        for (const fn of STATEMENT) {
          const result = fn(next, ctx);
          if (result !== next) {
            next = result;
            break;
          }
        }
      } else if (ts.isQualifiedName(next) || ts.isTypeReferenceNode(next)) {
        next = types.transformJasmineTypes(next, ctx);
      }
      const final = Array.isArray(next)
        ? next.map((n) => ts.visitEachChild(n, visitor, context))
        : ts.visitEachChild(next, visitor, context);
      if (next !== node && original.has(node)) replaced.set(node, final);
      return final;
    };
    return (node) => ts.visitEachChild(node, visitor, context);
  };
  ts.transform(sourceFile, [transformer]);

  // A node that carries a TODO note, and every node above it, must go through
  // the printer (which writes the note); nothing else does.
  const noted = new Set();
  for (const node of original) {
    if (!ts.getSyntheticLeadingComments(node)?.length) continue;
    for (let n = node; n; n = n.parent) noted.add(n);
  }

  const file = { sourceFile, content, original, noted };
  const edits = [];
  for (const [node, final] of replaced) {
    if (hasReplacedAncestor(node, replaced)) continue;
    edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: print(final, node, file) });
  }
  // TODO notes on statements the transformers did not replace: no print above
  // carries them, so they go in as text.
  for (const node of original) {
    const notes = ts.getSyntheticLeadingComments(node);
    if (!notes?.length || replaced.has(node) || hasReplacedAncestor(node, replaced)) continue;
    const at = node.getStart(sourceFile);
    const indent = indentAt(content, at);
    const text = notes.map((c) => (c.kind === ts.SyntaxKind.SingleLineCommentTrivia ? `//${c.text}` : `/*${c.text}*/`)).join(`\n${indent}`);
    edits.push({ start: at, end: at, text: `${text}\n${indent}` });
  }
  edits.push(...importRemovals(sourceFile, ctx.pendingImportSpecifierRemovals));
  if (ctx.pendingVitestTypeImports.size > 0) {
    const decl = astHelpers.getVitestAutoImports(new Set(), ctx.pendingVitestTypeImports);
    const first = sourceFile.statements[0];
    const at = first ? first.getStart(sourceFile) : 0;
    if (decl) edits.push({ start: at, end: at, text: `${printer.printNode(ts.EmitHint.Unspecified, decl, sourceFile).replaceAll('"', "'")}\n` });
  }

  let out = content;
  // Back to front; at one position the replacement goes before the insertion.
  for (const e of edits.sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function hasReplacedAncestor(node, replaced) {
  for (let p = node.parent; p; p = p.parent) if (replaced.has(p)) return true;
  return false;
}

function indentAt(content, pos) {
  const lineStart = content.lastIndexOf('\n', pos - 1) + 1;
  return /^[ \t]*/.exec(content.slice(lineStart))[0];
}

/**
 * Print a replacement and fit it into the original text.
 *
 * Only the new nodes go through the printer. Every node of the original file
 * that sits unchanged inside the replacement — an arrow function body, an
 * argument, a comment in front of a statement — is substituted by its own
 * source text, so its wrapping, comments and template literals survive byte
 * for byte. The printer's own lines get the project's 2-space steps on top of
 * the node's indent; the copied lines already have theirs.
 */
function print(final, node, { sourceFile, content, original, noted }) {
  const indent = indentAt(content, node.getStart(sourceFile));
  const top = node.getStart(sourceFile);
  const bottom = node.getEnd();
  const printer2 = ts.createPrinter(
    { newLine: ts.NewLineKind.LineFeed },
    {
      substituteNode(_hint, n) {
        if (!original.has(n)) {
          // A new node made by `update…` carries the source range of the node
          // it replaces, and the printer would print that range's comments
          // again — they are already in the text (before the splice point) or
          // come along with a copied child below.
          if (n.pos >= 0) ts.setEmitFlags(n, ts.getEmitFlags(n) | ts.EmitFlags.NoComments);
          return n;
        }
        if (noted.has(n) || n.kind === ts.SyntaxKind.SourceFile) return n;
        // Its comments come along — the leading ones unless they lie before
        // the splice point (they stay in the text there), the trailing ones
        // unless they lie after it.
        const lead = (ts.getLeadingCommentRanges(content, n.pos) ?? []).find((c) => c.pos >= top);
        const trail = (ts.getTrailingCommentRanges(content, n.end) ?? []).filter((c) => c.end <= bottom).at(-1);
        const from = lead ? lead.pos : n.getStart(sourceFile);
        return ts.factory.createIdentifier(OPEN + content.slice(from, trail ? trail.end : n.end) + CLOSE);
      },
    },
  );
  const nodes = Array.isArray(final) ? final : [final];
  // A block the transformers build (the fake-async rewrite does) prints on one
  // line unless told otherwise; the project writes them open.
  const openBlocks = (n) => {
    if (original.has(n)) return;
    if (ts.isBlock(n) && n.statements.length > 0) {
      n.multiLine = true;
      ts.setEmitFlags(n, ts.getEmitFlags(n) & ~ts.EmitFlags.SingleLine);
    }
    ts.forEachChild(n, openBlocks);
  };
  nodes.forEach(openBlocks);
  return nodes.map((n) => followUps(reindent(printer2.printNode(ts.EmitHint.Unspecified, n, sourceFile), indent))).join(`\n${indent}`);
}

/** Re-indent the printer's lines (4-space steps from column 0); keep copied lines; drop the brackets. */
function reindent(text, indent) {
  let depth = 0; // > 0 while inside copied source text
  return text
    .split('\n')
    .map((line, i) => {
      const copied = depth > 0;
      for (const ch of line) {
        if (ch === OPEN) depth++;
        else if (ch === CLOSE) depth--;
      }
      if (i === 0 || copied) return line;
      const lead = /^ */.exec(line)[0].length;
      return line.trim() === '' ? '' : indent + ' '.repeat(Math.floor(lead / 2)) + line.slice(lead);
    })
    .join('\n')
    .replaceAll(OPEN, '')
    .replaceAll(CLOSE, '');
}

/** Named imports the fake-async rewrite no longer needs (`fakeAsync`, `tick`, …). */
function importRemovals(sourceFile, removals) {
  const edits = [];
  if (removals.size === 0) return edits;
  for (const st of sourceFile.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteralLike(st.moduleSpecifier)) continue;
    const named = st.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    const drop = removals.get(st.moduleSpecifier.text);
    if (!drop || drop.size === 0) continue;
    const keep = named.elements.filter((el) => !drop.has((el.propertyName ?? el.name).text));
    if (keep.length === named.elements.length) continue;
    if (keep.length === 0 && !st.importClause.name) {
      const end = sourceFile.text[st.getEnd()] === '\n' ? st.getEnd() + 1 : st.getEnd();
      edits.push({ start: st.getStart(sourceFile), end, text: '' });
    } else {
      edits.push({ start: named.getStart(sourceFile), end: named.getEnd(), text: `{ ${keep.map((el) => el.getText(sourceFile)).join(', ')} }` });
    }
  }
  return edits;
}

function silentLogger() {
  const noop = () => {};
  return { info: noop, warn: noop, error: noop, debug: noop };
}

function specFiles(path) {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { recursive: true })
    .map((f) => join(path, String(f)))
    .filter((f) => f.endsWith('.spec.ts'));
}

function main(argv) {
  const fakeAsync = argv.includes('--fake-async');
  const dryRun = argv.includes('--dry-run');
  const paths = argv.filter((a) => !a.startsWith('--'));
  if (paths.length === 0) {
    console.error('usage: node scripts/jasmine-to-vitest.mjs [--fake-async] [--dry-run] <file|dir>...');
    process.exitCode = 2;
    return;
  }
  let changed = 0;
  let todos = 0;
  for (const file of paths.flatMap(specFiles)) {
    const reporter = new RefactorReporter(silentLogger());
    const name = relative(process.cwd(), file).replaceAll('\\', '/');
    const before = readFileSync(file, 'utf8');
    const after = migrate(name, before, { fakeAsync, reporter });
    if (after === before) continue;
    changed++;
    console.log(`${dryRun ? 'would update' : 'updated'} ${name}`);
    for (const { category, line } of reporter.fileTodos.get(name) ?? []) {
      todos++;
      console.log(`  TODO L${line}: ${category}`);
    }
    if (!dryRun) writeFileSync(file, after);
  }
  console.log(`${changed} file(s) ${dryRun ? 'would change' : 'changed'}, ${todos} TODO(s)`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) main(process.argv.slice(2));
