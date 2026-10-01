// A narrow, fail-closed preflight for model-authored patch content. It runs on
// the trusted worker before the candidate is written or executed. Docker's
// network/filesystem isolation and owner promotion gate remain authoritative.
import path from 'node:path';
import {createRequire} from 'node:module';

const requireController = createRequire(new URL('../../apps/controller/package.json', import.meta.url));
const CODE = new Set(['.js', '.mjs', '.ts']);
const EXECUTION_NAMES = new Set(['fetch', 'require', 'eval', 'Function', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'Worker', 'SharedWorker', 'sendBeacon']);
const GLOBAL_NAMES = new Set(['process', 'Deno', 'Bun']);
const SECRET_LITERAL = /(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

export class StaticPolicyError extends Error {
  constructor(reason) { super(`Candidate static policy: ${reason}`); this.code = 'static_policy_rejected'; this.reason = reason; }
}
const reject = reason => { throw new StaticPolicyError(reason); };

function parser() {
  try { return requireController('typescript'); }
  catch { reject('parser_unavailable'); }
}
function localModule(from, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) reject('external_import');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  if (!resolved.startsWith('projects/') || resolved.includes('/node_modules/')) reject('import_outside_projects');
}
function memberName(ts, expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) return expression.argumentExpression.text;
  return null;
}
function scanCode(filename, content) {
  const ts = parser();
  const kind = filename.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true, kind);
  if (source.parseDiagnostics.length) reject('invalid_syntax');
  function walk(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) reject('dynamic_import');
      localModule(filename, node.moduleSpecifier.text);
    }
    if (ts.isImportEqualsDeclaration(node)) reject('module_loader');
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) reject('dynamic_import');
      if (EXECUTION_NAMES.has(memberName(ts, node.expression))) reject('direct_effect');
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = memberName(ts, node);
      if (EXECUTION_NAMES.has(name)) reject('direct_effect');
      if (GLOBAL_NAMES.has(name)) reject('host_global');
    }
    if (ts.isIdentifier(node) && EXECUTION_NAMES.has(node.text)) reject('direct_effect');
    if (ts.isIdentifier(node) && GLOBAL_NAMES.has(node.text)) reject('host_global');
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && SECRET_LITERAL.test(node.text)) reject('secret_literal');
    ts.forEachChild(node, walk);
  }
  walk(source);
}
function scanMarkup(extension, content) {
  if (SECRET_LITERAL.test(content)) reject('secret_literal');
  if (/javascript\s*:|<\s*script\b|\bon[a-z]+\s*=|<\s*foreignObject\b/i.test(content)) reject('active_markup');
  if (/(?:\b(?:src|srcset|action|formaction|poster|data|xlink:href)\s*=\s*["']\s*(?:https?:|\/\/)|<\s*link\b[^>]*\bhref\s*=\s*["']\s*(?:https?:|\/\/)|@import\b|url\(\s*["']?\s*(?:https?:|\/\/))/i.test(content)) reject('external_resource');
  if (extension === '.svg' && /<\s*(?:iframe|image|use)\b/i.test(content)) reject('active_svg_reference');
}

export function assertCandidatePatchPolicy(patch) {
  if (!patch || !Array.isArray(patch.changes)) reject('invalid_patch');
  for (const change of patch.changes) {
    if (typeof change.path !== 'string' || typeof change.content !== 'string') reject('invalid_change');
    const extension = path.posix.extname(change.path).toLowerCase();
    if (CODE.has(extension)) scanCode(change.path, change.content);
    else if (['.html', '.css', '.svg'].includes(extension)) scanMarkup(extension, change.content);
    else reject('unsupported_extension');
  }
  return true;
}
