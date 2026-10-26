/** Static source graph for extraction review. Does not import or execute application code. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const slash = p => p.split(path.sep).join('/');
const rel = p => slash(path.relative(root, p));
const roots = ['packages', 'shared', 'client', 'server', 'scripts'];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(e => {
    if (['node_modules', 'dist', 'public', '.git'].includes(e.name)) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(?:[cm]?[jt]s|vue)$/.test(e.name) ? [rel(p)] : [];
  });
}
const files = roots.flatMap(dir => walk(path.join(root, dir)));
const fileSet = new Set(files);
const units = fs.readdirSync(path.join(root, 'packages')).filter(d => fs.existsSync(path.join(root, 'packages', d, 'package.json'))).sort().map(d => `packages/${d}`).concat(['shared', 'client', 'server']);
const manifests = Object.fromEntries(units.map(dir => [dir, JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8').replace(/^\uFEFF/, ''))]));
const byName = new Map(Object.entries(manifests).map(([dir, m]) => [m.name, dir]));
const owner = file => units.find(u => file.startsWith(u + '/')) ?? 'scripts';
function resolveLocal(base) {
  const key = slash(path.normalize(base));
  const stem = key.replace(/\.(?:js|mjs|cjs)$/, '');
  return [key, stem + '.ts', stem + '.mts', stem + '.cts', key + '.ts', key + '.vue', key + '.js', key + '.cjs', key + '/index.ts', key + '/index.js'].find(p => fileSet.has(p)) ?? null;
}
const edges = [], unresolvedLocal = [], nonLiteralCalls = [];
for (const file of files) {
  const original = fs.readFileSync(path.join(root, file), 'utf8');
  // Keep positions in .vue source: only parse <script> blocks, not the template.
  let source = original;
  if (file.endsWith('.vue')) {
    const chunks = [...original.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
    source = original.split('').map(c => c === '\n' ? '\n' : ' ').join('');
    for (const m of chunks) {
      const offset = m.index + m[0].indexOf('>') + 1;
      source = source.slice(0, offset) + m[1] + source.slice(offset + m[1].length);
    }
  }
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function add(node, spec, typeOnly, syntax) {
    const packageName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    const packageDir = byName.get(packageName);
    let target = null;
    if (spec.startsWith('.')) target = resolveLocal(path.join(path.dirname(file), spec));
    else if (spec.startsWith('@/')) target = resolveLocal('client/src/' + spec.slice(2));
    else if (packageDir) {
      const subpath = spec.slice(packageName.length + 1);
      target = resolveLocal(subpath ? `${packageDir}/${subpath}` : `${packageDir}/src/index.ts`);
    }
    const edge = { from: file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, specifier: spec, typeOnly, syntax, to: target, fromUnit: owner(file), toUnit: target ? owner(target) : packageDir ?? packageName };
    edges.push(edge);
    if (!target && (spec.startsWith('.') || spec.startsWith('@/') || packageDir)) unresolvedLocal.push(edge);
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      let typeOnly = Boolean(node.isTypeOnly || node.importClause?.isTypeOnly);
      const bindings = node.importClause?.namedBindings ?? node.exportClause;
      if (!node.importClause?.name && bindings?.elements?.length && bindings.elements.every(e => e.isTypeOnly)) typeOnly = true;
      add(node, node.moduleSpecifier.text, typeOnly, ts.isExportDeclaration(node) ? 'export' : 'import');
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      add(node, node.argument.literal.text, true, 'import-type');
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      if (node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) add(node, node.arguments[0].text, false, 'call');
      else nonLiteralCalls.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
function scc(nodes, links) {
  const adjacency = new Map(nodes.map(n => [n, []]));
  for (const [a, b] of links) adjacency.get(a)?.push(b);
  let next = 0;
  const index = new Map(), low = new Map(), stack = [], active = new Set(), result = [];
  function visit(v) {
    index.set(v, next); low.set(v, next++); stack.push(v); active.add(v);
    for (const w of adjacency.get(v) ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (active.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const component = []; let w;
      do { w = stack.pop(); active.delete(w); component.push(w); } while (w !== v);
      if (component.length > 1 || (adjacency.get(v) ?? []).includes(v)) result.push(component.sort());
    }
  }
  nodes.forEach(v => { if (!index.has(v)) visit(v); });
  return result.sort((a, b) => a[0].localeCompare(b[0], 'en'));
}
const local = edges.filter(e => e.to);
const cross = local.filter(e => e.fromUnit !== e.toUnit);
const packageEdges = Object.entries(manifests).flatMap(([dir, m]) => Object.entries(m.dependencies ?? {}).filter(([name]) => byName.has(name)).map(([name, version]) => ({ from: dir, to: byName.get(name), version })));
const summary = {};
for (const e of cross) {
  const key = `${e.fromUnit} -> ${e.toUnit}`;
  summary[key] ??= { value: 0, typeOnly: 0 };
  summary[key][e.typeOnly ? 'typeOnly' : 'value']++;
}
const engineDirs = units.filter(u => u.startsWith('packages/') && u !== 'packages/voxel-lab');
const engineFiles = files.filter(f => engineDirs.some(u => f.startsWith(u + '/src/')));
const proposedContentFiles = ['voxel-builders.ts', 'voxel-kit/kit-assembler.ts', 'voxel-kit/parts-library.ts'];
const mixedFiles = ['dark-palette.ts', 'voxel-palette-core.ts', 'voxel-stamps/voxel-stamps.ts'];
const inventory = engineFiles.map(file => {
  const suffix = file.replace('packages/voxel-core/src/', '');
  const classification = file.startsWith('packages/voxel-core/src/') && proposedContentFiles.includes(suffix) ? 'game-content-stay-in-Tower' : file.startsWith('packages/voxel-core/src/') && mixedFiles.includes(suffix) ? 'mixed-split-before-extraction' : 'engine';
  return { file, classification, sha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') };
});
const output = {
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  method: 'TypeScript AST; literal import/export/require/import-type, Vue script blocks. Workspace names map to logical src/index.ts for graph analysis only; runtime still uses package exports. TypeOnly is syntactic, value edges are conservative. No computed imports, strings containing generated code, assets, or runtime DI analysis.',
  scannedFiles: files.length, importEdges: edges.length,
  manifests: Object.fromEntries(Object.entries(manifests).map(([dir, m]) => [dir, { name: m.name, dependencies: m.dependencies ?? {}, peerDependencies: m.peerDependencies ?? {} }])),
  packageEdges, crossUnitSummary: summary,
  cycles: {
    declaredPackages: scc(units, packageEdges.map(e => [e.from, e.to])),
    sourceUnits: scc([...units, 'scripts'], cross.map(e => [e.fromUnit, e.toUnit])),
    productionSourceUnits: scc(units, cross.filter(e => e.from.includes('/src/')).map(e => [e.fromUnit, e.toUnit])),
    sourceFilesAll: scc(files, local.map(e => [e.from, e.to])),
    sourceFilesValue: scc(files, local.filter(e => !e.typeOnly).map(e => [e.from, e.to])),
  },
  reverseEngineEdges: cross.filter(e => engineDirs.includes(e.fromUnit) && !engineDirs.includes(e.toUnit)),
  engineSourceBypasses: edges.filter(e => !engineDirs.includes(e.fromUnit) && e.to && engineDirs.includes(e.toUnit) && (e.specifier.startsWith('.') || /\/(src|dist)\//.test(e.specifier))),
  undeclaredWorkspaceEdges: cross.filter(e => e.fromUnit !== 'scripts' && !Object.hasOwn(manifests[e.fromUnit]?.dependencies ?? {}, manifests[e.toUnit]?.name)),
  unresolvedLocal, nonLiteralCalls, inventory, edges,
};
// Keep the pre-migration evidence immutable when re-running after extraction.
const destination = path.join(root, 'docs/sciens/voxkera-dependencies-current.json');
fs.writeFileSync(destination, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ output: rel(destination), scannedFiles: output.scannedFiles, importEdges: edges.length, crossUnitSummary: summary, cycles: output.cycles, reverseEngineEdges: output.reverseEngineEdges, bypasses: output.engineSourceBypasses.length, unresolvedLocal, nonLiteralCalls, classifications: inventory.reduce((a, m) => (a[m.classification] = (a[m.classification] ?? 0) + 1, a), {}) }, null, 2));
