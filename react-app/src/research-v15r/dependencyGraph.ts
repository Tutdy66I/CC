export type DependencyNode = { path: string; dependencies: readonly string[] };

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
      /^(?:0[1-6]-.*\.json|manifest(?:\..*)?)$/i.test(path) ||
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
