// Component Lineage & State Blast-Radius Tracer for DevDesk
// Correlates DOM user action -> Component hierarchy -> State mutation -> Network origin

export function traceComponentLineage(capture) {
  if (!capture || !Array.isArray(capture.events)) {
    return { status: 'empty_capture', lineage: null };
  }

  const events = [...capture.events].sort((a, b) => (a.ts || 0) - (b.ts || 0));

  // Find the primary error
  const errorEvent = events.find(e =>
    e.type === 'console' && ['error', 'exception'].includes(e.level || e.data?.level)
  );

  const errorTs = errorEvent?.ts ?? Infinity;

  // Find the action directly preceding the error
  const precedingActions = events
    .filter(e => e.type === 'action' && (e.ts || 0) <= errorTs)
    .slice(-3);
  const primaryAction = precedingActions[precedingActions.length - 1] || null;

  // Find the network requests occurring within 2000ms preceding the error
  const precedingNetwork = events
    .filter(e => e.type === 'network' && (e.ts || 0) <= errorTs && (errorTs - (e.ts || 0)) < 2500)
    .map(e => ({
      method: e.method || e.data?.method || 'GET',
      url: e.url || e.data?.url || '',
      status: e.status || e.data?.status || 0,
      offsetMs: errorTs !== Infinity ? errorTs - (e.ts || 0) : 0
    }));

  // Find any captured state snapshots
  const stateSnapshots = events
    .filter(e => e.type === 'app' && e.data?.kind === 'state:snapshot')
    .map(e => ({
      store: e.data?.data?.store || 'default',
      snapshot: e.data?.data?.snapshot || {}
    }));

  // Inferred component name from selector / label
  const selector = primaryAction?.selector || primaryAction?.data?.selector || primaryAction?.target || '';
  const label = primaryAction?.label || primaryAction?.data?.label || '';
  const inferredComponent = inferComponentName(selector, label);

  return {
    captureId: capture.id,
    hasException: Boolean(errorEvent),
    exception: errorEvent ? {
      message: errorEvent.text || errorEvent.data?.message || errorEvent.data?.text || 'Unknown Error',
      stack: errorEvent.data?.stack || null
    } : null,
    trigger: primaryAction ? {
      action: primaryAction.kind || primaryAction.action || primaryAction.data?.action || 'click',
      selector,
      label,
      inferredComponent
    } : null,
    recentNetworkOrigins: precedingNetwork,
    activeStateStores: stateSnapshots,
    causalChain: [
      primaryAction ? `User triggered '${primaryAction.action || 'action'}' on ${inferredComponent} (${selector})` : 'App initialization',
      precedingNetwork.length ? `Network requests fired: ${precedingNetwork.map(n => `${n.method} ${n.url} (${n.status})`).join(', ')}` : 'No immediate network activity',
      errorEvent ? `Exception thrown: ${errorEvent.text || errorEvent.data?.message || 'Error'}` : 'No uncaught exception'
    ],
    diagnosisVerdict: errorEvent && precedingNetwork.some(n => n.status >= 400)
      ? 'Exception directly triggered by downstream HTTP failure.'
      : errorEvent && precedingNetwork.length > 0
        ? 'Exception likely caused by client state deserialization from recent API payload.'
        : 'Exception occurred in local component render lifecycle.'
  };
}

function inferComponentName(selector, label) {
  if (!selector && !label) return '<UnknownComponent>';
  // Look for data-component or testid
  const compMatch = /data-(?:component|testid)=["']([^"']+)["']/i.exec(selector);
  if (compMatch) return `<${capitalize(compMatch[1])}>`;

  // Check ID or class
  const idMatch = /#([a-z0-9_-]+)/i.exec(selector);
  if (idMatch) return `<${capitalize(idMatch[1].replace(/[-_](btn|button|input|form)$/i, ''))}>`;

  if (label) return `<${capitalize(label.replace(/[^a-z0-9]/gi, ''))}>`;
  return '<Component>';
}

function capitalize(str) {
  if (!str) return 'Component';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
