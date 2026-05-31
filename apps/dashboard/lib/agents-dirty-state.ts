let hasUnsavedAgentsChanges = false;
let pendingNavigation: { href: string; resolve: (allow: boolean) => void } | null = null;

export function setAgentsDirty(dirty: boolean): void {
  hasUnsavedAgentsChanges = dirty;
}

export function getAgentsDirty(): boolean {
  return hasUnsavedAgentsChanges;
}

export function requestNavigation(href: string): Promise<boolean> {
  if (!hasUnsavedAgentsChanges) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    pendingNavigation = { href, resolve };
    window.dispatchEvent(
      new CustomEvent("agents:confirm-navigation", { detail: { href } })
    );
  });
}

export function confirmNavigation(allow: boolean): void {
  if (pendingNavigation) {
    pendingNavigation.resolve(allow);
    pendingNavigation = null;
  }
}
