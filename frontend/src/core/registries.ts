import { NavEntry, RouteEntry, WidgetEntry, Role } from './types';

class NavRegistry {
  private entries: Map<string, NavEntry> = new Map();

  register(items: NavEntry | NavEntry[]): void {
    const list = Array.isArray(items) ? items : [items];
    for (const item of list) {
      this.entries.set(item.id, item);
    }
  }

  all(role?: Role): NavEntry[] {
    const list = Array.from(this.entries.values());
    const filtered = role ? list.filter((e) => e.roles.includes(role)) : list;
    return filtered.sort((a, b) => a.order - b.order);
  }

  clear(): void {
    this.entries.clear();
  }
}

class RouteRegistry {
  private entries: Map<string, RouteEntry> = new Map();

  register(items: RouteEntry | RouteEntry[]): void {
    const list = Array.isArray(items) ? items : [items];
    for (const item of list) {
      this.entries.set(item.path, item);
    }
  }

  all(role?: Role): RouteEntry[] {
    const list = Array.from(this.entries.values());
    if (!role) return list;
    return list.filter((e) => e.roles.includes(role));
  }

  clear(): void {
    this.entries.clear();
  }
}

class WidgetRegistry {
  private entries: Map<string, WidgetEntry> = new Map();

  register(items: WidgetEntry | WidgetEntry[]): void {
    const list = Array.isArray(items) ? items : [items];
    for (const item of list) {
      this.entries.set(item.id, item);
    }
  }

  forZone(zone: 'kpi' | 'main' | 'side', role?: Role): WidgetEntry[] {
    const list = Array.from(this.entries.values()).filter((e) => e.zone === zone);
    const filtered = role ? list.filter((e) => e.roles.includes(role)) : list;
    return filtered.sort((a, b) => a.order - b.order);
  }

  all(): WidgetEntry[] {
    return Array.from(this.entries.values());
  }

  clear(): void {
    this.entries.clear();
  }
}

export const navRegistry = new NavRegistry();
export const routeRegistry = new RouteRegistry();
export const widgetRegistry = new WidgetRegistry();
