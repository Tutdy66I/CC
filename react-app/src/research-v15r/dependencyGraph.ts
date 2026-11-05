export type DependencyNode = { path: string; dependencies: readonly string[] };

// Candidate protocol root is not yet fixed. Reserve these exact protocol names
// in every directory, including case variants, until it has been reviewed.
const protocolNames = new Set([
  "01-model.json",
  "02-random.json",
  "03-statistics.json",
  "04-numeric.json",
  "05-evidence.json",
  "06-dependencies.json",
]);

function reservedDependency(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  return (
    protocolNames.has(base) ||
    base === "manifest" ||
    base.startsWith("manifest.") ||
    /^(?:0[1-6]-.*\.json)$/i.test(path)
  );
}

/** Validates declared paths and edges only. It cannot certify filesystem links or closure. */
export function validateDependencyGraph(
  nodes: readonly DependencyNode[],
): void {
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > 100_000)
    throw new Error("Invalid dependency list");
  const byPath = new Map<string, DependencyNode>();
  const folded = new Set<string>();
  let previous = "";
  for (const node of nodes) {
    const path = node.path;
    if (
      typeof path !== "string" ||
      !/^[A-Za-z0-9_./+-]+$/.test(path) ||
      path.startsWith("/") ||
      path.endsWith("/") ||
      path.includes("//") ||
      path
        .split("/")
        .some(
          (part) =>
            part === "." ||
            part === ".." ||
            part.endsWith(".") ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        ) ||
      reservedDependency(path) ||
      path <= previous ||
      folded.has(path.toLowerCase()) ||
      !Array.isArray(node.dependencies)
    )
      throw new Error("Invalid dependency path");
    previous = path;
    folded.add(path.toLowerCase());
    byPath.set(path, node);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (path: string) => {
    if (active.has(path)) throw new Error("Dependency cycle");
    if (visited.has(path)) return;
    const node = byPath.get(path);
    if (!node) throw new Error("Missing dependency");
    active.add(path);
    const edges = new Set<string>();
    for (const edge of node.dependencies) {
      if (typeof edge !== "string" || edges.has(edge))
        throw new Error("Invalid edge");
      edges.add(edge);
      visit(edge);
    }
    active.delete(path);
    visited.add(path);
  };
  for (const path of byPath.keys()) visit(path);
}
