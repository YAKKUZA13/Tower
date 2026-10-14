/** Renderer-independent, deterministic 4-connected navigation with interaction goals. */
export interface NavigationCell { col: number; row: number }
export interface NavigationGrid { cols: number; rows: number; cellSize: number }
export type NavigationBlocked = (col: number, row: number) => boolean;

export function findNavigationPath(grid: NavigationGrid, start: NavigationCell, goal: NavigationCell,
  blocked: NavigationBlocked, radius = 0, canStop: NavigationBlocked = () => true): NavigationCell[] | null {
  const { cols, rows } = grid;
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows;
  if (!inside(start.col, start.row) || !inside(goal.col, goal.row)) return null;
  const parent = new Int32Array(cols * rows).fill(-1);
  const first = start.row * cols + start.col;
  const queue = [first];
  parent[first] = first;
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!;
    const col = index % cols, row = Math.floor(index / cols);
    if ((col - goal.col) ** 2 + (row - goal.row) ** 2 <= radius ** 2 && !blocked(col, row) && canStop(col,row)) {
      const path: NavigationCell[] = [];
      for (let i = index; ; i = parent[i]!) {
        path.push({ col: i % cols, row: Math.floor(i / cols) });
        if (i === first) break;
      }
      return path.reverse();
    }
    for (const [dc, dr] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const c = col + dc!, r = row + dr!;
      if (!inside(c, r) || blocked(c, r)) continue;
      const next = r * cols + c;
      if (parent[next] !== -1) continue;
      parent[next] = index;
      queue.push(next);
    }
  }
  return null;
}

/** Cached paths are revalidated so newly placed buildings never become shortcuts. */
export class GridNavigator {
  private routes = new Map<string, { key: string; path: NavigationCell[]; cursor: number }>();
  constructor(private grid: NavigationGrid, private blocked: NavigationBlocked) {}
  forget(id: string): void { this.routes.delete(id); }
  clear(): void { this.routes.clear(); }
  move(id: string, position: { x: number; z: number }, goal: NavigationCell,
    distance: number, radius = 0): 'moving' | 'arrived' | 'blocked' {
    const grid = this.grid;
    const cell = {
      col: Math.floor(position.x / grid.cellSize + grid.cols / 2),
      row: Math.floor(position.z / grid.cellSize + grid.rows / 2)
    };
    const key = `${goal.col}:${goal.row}:${radius}`;
    let route = this.routes.get(id);
    if (!route || route.key !== key || route.path.slice(route.cursor).some(c => this.blocked(c.col, c.row))) {
      const path = findNavigationPath(grid, cell, goal, this.blocked, radius);
      if (!path) { this.routes.delete(id); return 'blocked'; }
      route = { key, path, cursor: path.length > 1 ? 1 : 0 };
      this.routes.set(id, route);
    }
    let remaining = Math.max(0, distance);
    while (route.cursor < route.path.length) {
      const target = route.path[route.cursor]!;
      const x = (target.col + .5 - grid.cols / 2) * grid.cellSize;
      const z = (target.row + .5 - grid.rows / 2) * grid.cellSize;
      const dx = x - position.x, dz = z - position.z, length = Math.hypot(dx, dz);
      if (length > remaining + 1e-6) {
        if (remaining > 0) { position.x += dx / length * remaining; position.z += dz / length * remaining; }
        return 'moving';
      }
      position.x = x; position.z = z;
      remaining -= length;
      route.cursor++;
    }
    return 'arrived';
  }
}

/** Deterministic local spacing, constrained to traversable ground. Not a physics solver. */
export function separateNavigationAgents(grid: NavigationGrid,
  agents: readonly { id: string; position: { x: number; z: number } }[], blocked: NavigationBlocked, spacing = .55): void {
  const minimum = spacing * grid.cellSize;
  const tryOffset = (agent: typeof agents[number], dx: number, dz: number): void => {
    const x = agent.position.x + dx, z = agent.position.z + dz;
    const col = Math.floor(x/grid.cellSize+grid.cols/2), row = Math.floor(z/grid.cellSize+grid.rows/2);
    if(col>=0 && row>=0 && col<grid.cols && row<grid.rows && !blocked(col,row)) {
      agent.position.x=x;agent.position.z=z;
    }
  };
  for(let i=0;i<agents.length;i++) for(let j=i+1;j<agents.length;j++) {
    const a=agents[i]!,b=agents[j]!;
    let dx=b.position.x-a.position.x, dz=b.position.z-a.position.z;
    let distance=Math.hypot(dx,dz);
    if(distance>=minimum) continue;
    if(distance<1e-6) { dx=1;dz=0;distance=1; }
    const push=Math.min(grid.cellSize*.15,(minimum-Math.hypot(b.position.x-a.position.x,b.position.z-a.position.z))*.5);
    tryOffset(a,-dx/distance*push,-dz/distance*push);
    tryOffset(b,dx/distance*push,dz/distance*push);
  }
}
