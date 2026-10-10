'use strict';

(function exposeDependencyInstaller(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ContentDependencyInstaller = api;
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
  function normalizeId(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getInstalledIds(entries) {
    return new Set((Array.isArray(entries) ? entries : [])
      .flatMap(entry => [entry?.id, entry?.slug])
      .map(normalizeId)
      .filter(Boolean));
  }

  async function installRequiredDependencies({
    dependencies,
    target,
    scope,
    confirmDownload,
    searchContent,
    installContent,
  } = {}) {
    if (!target || !scope || typeof confirmDownload !== 'function'
      || typeof searchContent !== 'function' || typeof installContent !== 'function') {
      throw new Error('Dependency installation requires a target, scope, and launcher callbacks.');
    }

    const collection = scope.serverId ? target.installedContent : target.mods;
    if (!Array.isArray(collection)) throw new Error('The target has no installed-content collection.');

    const scheduledIds = getInstalledIds(collection);
    const queue = [];
    const enqueue = requirements => {
      for (const requirement of Array.isArray(requirements) ? requirements : []) {
        const projectId = String(requirement?.projectId || '').trim();
        const normalizedId = normalizeId(projectId);
        if (!normalizedId || scheduledIds.has(normalizedId)) continue;
        scheduledIds.add(normalizedId);
        queue.push({ projectId, versionId: requirement.versionId ? String(requirement.versionId) : null });
      }
    };
    enqueue(dependencies);

    let installedCount = 0;
    let declined = false;
    const errors = [];
    while (queue.length) {
      const batch = queue.splice(0);
      const resolved = await Promise.all(batch.map(async dependency => {
        try {
          const result = await searchContent({
            query: dependency.projectId,
            type: 'mod',
            mcVersion: String(target.mcVersion || ''),
            loader: String(target.loader || target.serverType || ''),
            serverType: scope.serverId ? target.serverType : undefined,
            source: 'modrinth',
          });
          if (!result?.ok) {
            return { dependency, error: result?.error || 'Modrinth search failed.' };
          }
          const exact = (Array.isArray(result.hits) ? result.hits : []).filter(candidate =>
            candidate?.type === 'mod'
            && (normalizeId(candidate.id) === normalizeId(dependency.projectId)
              || normalizeId(candidate.slug) === normalizeId(dependency.projectId)));
          if (exact.length !== 1) {
            return {
              dependency,
              error: exact.length
                ? 'Multiple compatible results matched this project ID.'
                : 'No compatible result matched this exact project ID.',
            };
          }
          return { dependency, candidate: exact[0] };
        } catch (error) {
          return { dependency, error: error instanceof Error ? error.message : String(error) };
        }
      }));

      for (const item of resolved) {
        if (item.error) errors.push(`${item.dependency.projectId}: ${item.error}`);
      }
      const available = resolved.filter(item => item.candidate);
      if (!available.length) continue;

      const names = available.map(item => item.candidate.name || item.dependency.projectId);
      const accepted = await confirmDownload({
        names,
        projectIds: available.map(item => item.dependency.projectId),
        transitive: installedCount > 0,
      });
      if (!accepted) {
        declined = true;
        break;
      }

      for (const item of available) {
        const candidate = item.candidate;
        const payload = {
          ...candidate,
          type: 'mod',
          source: 'modrinth',
          versionId: item.dependency.versionId || candidate.versionId || null,
          ...(scope.serverId ? { serverId: scope.serverId } : { profileId: scope.profileId }),
        };
        try {
          const result = await installContent(payload);
          if (!result?.ok) {
            errors.push(`${candidate.name || item.dependency.projectId}: ${result?.error || 'Installation failed.'}`);
            continue;
          }
          installedCount += 1;
          if (result.entry && !getInstalledIds(collection).has(normalizeId(result.entry.id))) {
            collection.push(result.entry);
          }
          enqueue(result.requiredDependencies);
        } catch (error) {
          errors.push(`${candidate.name || item.dependency.projectId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return { installedCount, declined, errors };
  }

  return { installRequiredDependencies };
}));
