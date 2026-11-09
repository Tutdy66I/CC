// Static ESM edges only; no claim about dynamic/native runtime closure.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const entries = [
  "scripts/v15-numeric-public-node.mjs",
  "scripts/v15-envelopes-public-node.mjs",
  "scripts/v15-angle-public-node.mjs",
  "scripts/v15-interval-public-node.mjs",
  "scripts/v15-zf-trace-public.mjs",
];
const seen = new Set(),
  edges = [],
  dynamic = [];
function visit(file) {
  file = path.posix.normalize(file);
  if (seen.has(file)) return;
  if (!file.startsWith("scripts/") && !file.startsWith(".test-build/src/lib/"))
    throw new Error(`unexpected import path: ${file}`);
  seen.add(file);
  const text = fs.readFileSync(file, "utf8");
  const tree = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  function walk(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      if (!ts.isStringLiteral(node.moduleSpecifier))
        throw new Error(`nonliteral static import: ${file}`);
      const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith("node:"))
        edges.push({ from: file, to: specifier });
      else if (specifier.startsWith(".")) {
        const target = path.posix.normalize(
          path.posix.join(path.posix.dirname(file), specifier),
        );
        edges.push({ from: file, to: target });
        visit(target);
      } else throw new Error(`unexpected external import: ${specifier}`);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    )
      dynamic.push({
        from: file,
        expression: node.getText(tree).replaceAll("\r\n", "\n"),
      });
    ts.forEachChild(node, walk);
  }
  walk(tree);
}
entries.forEach(visit);
console.log(
  JSON.stringify(
    {
      entries,
      files: [...seen].sort(),
      edges: edges.sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b)
          ? -1
          : JSON.stringify(a) > JSON.stringify(b)
            ? 1
            : 0,
      ),
      dynamic,
    },
    null,
    2,
  ),
);
