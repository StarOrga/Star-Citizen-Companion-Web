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

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

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

  const edits = [];
  for (const [node, final] of replaced) {
    if (hasReplacedAncestor(node, replaced)) continue;
    edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: print(final, node, sourceFile, content) });
  }
  edits.push(...importRemovals(sourceFile, ctx.pendingImportSpecifierRemovals));
  if (ctx.pendingVitestTypeImports.size > 0) {
    const decl = astHelpers.getVitestAutoImports(new Set(), ctx.pendingVitestTypeImports);
    const first = sourceFile.statements[0];
    const at = first ? first.getStart(sourceFile) : 0;
    if (decl) edits.push({ start: at, end: at, text: `${printer.printNode(ts.EmitHint.Unspecified, decl, sourceFile)}\n` });
  }

  let out = content;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function hasReplacedAncestor(node, replaced) {
  for (let p = node.parent; p; p = p.parent) if (replaced.has(p)) return true;
  return false;
}

/**
 * Print a replacement and fit it into the original text: the printer indents
 * by 4 from column 0; the project indents by 2 from the node's own line.
 */
function print(final, node, sourceFile, content) {
  const nodes = Array.isArray(final) ? final : [final];
  const lineStart = content.lastIndexOf('\n', node.getStart(sourceFile) - 1) + 1;
  const indent = /^[ \t]*/.exec(content.slice(lineStart))[0];
  // The printer re-emits the comments in front of the original node, but they
  // stay in the text before the splice point — drop the copies.
  const leading = (ts.getLeadingCommentRanges(content, node.pos) ?? []).map((r) => content.slice(r.pos, r.end));
  const withoutLeading = (text) => {
    let head = text;
    for (const c of leading) {
      const at = head.indexOf(c);
      if (at < 0 || head.slice(0, at).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|\s/g, '') !== '') continue;
      head = head.slice(0, at) + head.slice(at + c.length).replace(/^\s*/, '');
    }
    return head;
  };
  return nodes
    .map((n, i) => {
      const printed = printer.printNode(ts.EmitHint.Unspecified, n, sourceFile);
      return i === 0 ? withoutLeading(printed) : printed;
    })
    .join(`\n${indent}`)
    .split('\n')
    .map((line, i) => {
      if (i === 0) return line;
      const lead = /^ */.exec(line)[0].length;
      return line.trim() === '' ? '' : indent + ' '.repeat(Math.floor(lead / 2)) + line.slice(lead);
    })
    .join('\n');
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
