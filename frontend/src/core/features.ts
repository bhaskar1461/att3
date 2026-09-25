import { FeatureManifest } from './types';
import { navRegistry, routeRegistry, widgetRegistry } from './registries';

// Auto-discovery of all feature manifests located in src/features/*/manifest.ts
const manifests = import.meta.glob<{ default?: FeatureManifest; manifest?: FeatureManifest } | FeatureManifest>(
  '../features/*/manifest.ts',
  { eager: true }
);

export function initializeFeatures(): void {
  const sortedKeys = Object.keys(manifests).sort();

  for (const key of sortedKeys) {
    const raw = manifests[key];
    const manifest: FeatureManifest | undefined =
      (raw as any)?.default ?? (raw as any)?.manifest ?? (raw as FeatureManifest);

    if (manifest && typeof manifest === 'object' && manifest.name) {
      if (manifest.nav && Array.isArray(manifest.nav)) {
        navRegistry.register(manifest.nav);
      }
      if (manifest.routes && Array.isArray(manifest.routes)) {
        routeRegistry.register(manifest.routes);
      }
      if (manifest.widgets && Array.isArray(manifest.widgets)) {
        widgetRegistry.register(manifest.widgets);
      }
    }
  }
}

// Auto-initialize on import
initializeFeatures();
