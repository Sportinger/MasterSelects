// Dev Quick Login is offered on a local dev origin only: the main dev server (localhost:5173) and,
// in a development build, any localhost port (task worktrees and Playwright run Vite on their own
// ports and need their own sign-in, AGENTS.md section 1).
export function isLocalDevAuthHost(hostname: string, port: string, devBuild: boolean): boolean {
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') return false;
  return port === '5173' || devBuild;
}
