// Zero-dependency Compact Accessibility Tree & Click-Trap Auditor for DevDesk
// Reduces 100KB raw HTML dumps down to ~1KB high-signal accessibility trees (95% token reduction)

export function buildA11yTree(html) {
  if (!html || typeof html !== 'string') return { treeText: '', nodeCount: 0, tree: [] };

  const nodes = [];
  // Regex to match individual semantic and interactive tags
  const tagRegex = /<([a-z0-9-]+)(\s+[^>]*)?>([^<]*)?/gi;
  let match;

  const getAttr = (attrs, name) => {
    const m = new RegExp(`${name}=["']([^"']*)["']`, 'i').exec(attrs);
    return m ? m[1] : null;
  };

  const cleanText = (str) => {
    return (str || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  };

  while ((match = tagRegex.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = match[2] || '';
    const inner = match[3] || '';

    // Ignore non-semantic wrapper tags
    if (!['button', 'a', 'input', 'select', 'textarea', 'dialog', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag) && !attrs.includes('role=')) {
      continue;
    }

    const ariaLabel = getAttr(attrs, 'aria-label');
    const roleAttr = getAttr(attrs, 'role');
    const ariaHidden = getAttr(attrs, 'aria-hidden') === 'true';
    if (ariaHidden) continue;

    let role = roleAttr || null;
    let label = ariaLabel || cleanText(inner);

    if (tag === 'button') role = role || 'button';
    else if (tag === 'a' && getAttr(attrs, 'href')) {
      role = role || 'link';
      label = label || getAttr(attrs, 'href');
    } else if (tag === 'input') {
      const type = getAttr(attrs, 'type') || 'text';
      role = role || (type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : 'textbox');
      label = label || getAttr(attrs, 'placeholder') || getAttr(attrs, 'name') || type;
    } else if (tag === 'select') role = role || 'combobox';
    else if (tag === 'textarea') role = role || 'textbox';
    else if (tag === 'dialog') role = role || 'dialog';
    else if (/^h[1-6]$/.test(tag)) role = role || `heading[level=${tag[1]}]`;
    else if (roleAttr) role = roleAttr;
    else continue;

    const disabled = /\bdisabled\b/i.test(attrs);
    const required = /\brequired\b/i.test(attrs);
    const expanded = getAttr(attrs, 'aria-expanded');

    const stateProps = [];
    if (disabled) stateProps.push('disabled');
    if (required) stateProps.push('required');
    if (expanded !== null) stateProps.push(`expanded=${expanded}`);

    nodes.push({
      tag,
      role,
      name: label || '<unnamed>',
      states: stateProps,
      selector: getAttr(attrs, 'id') ? `#${getAttr(attrs, 'id')}` : tag
    });
  }

  // Format into compact text tree
  const treeText = nodes.map(n => {
    const stateStr = n.states.length ? ` [${n.states.join(', ')}]` : '';
    return `- ${n.role} "${n.name}"${stateStr}`;
  }).join('\n');

  return {
    nodeCount: nodes.length,
    treeText,
    tree: nodes,
    tokenEstimate: Math.round(treeText.length / 4)
  };
}

export function auditClickTraps(html) {
  if (!html || typeof html !== 'string') return { traps: [], clean: true };

  const traps = [];

  // Check 1: Invisible full-screen overlays capturing clicks
  const overlayRegex = /<([a-z0-9-]+)[^>]*style=["']([^"']*)["'][^>]*>/gi;
  let match;
  while ((match = overlayRegex.exec(html)) !== null) {
    const tag = match[1];
    const style = match[2].toLowerCase();

    const isFixedOrAbs = style.includes('position: fixed') || style.includes('position: absolute') || style.includes('position:fixed') || style.includes('position:absolute');
    const isHighZIndex = /z-index:\s*(?:999|\d{4,})/i.test(style);
    const isTransparent = style.includes('opacity: 0') || style.includes('opacity:0') || style.includes('background: transparent');
    const hasPointerEvents = !style.includes('pointer-events: none') && !style.includes('pointer-events:none');

    if (isFixedOrAbs && isHighZIndex && isTransparent && hasPointerEvents) {
      traps.push({
        kind: 'invisible_click_interceptor',
        severity: 'critical',
        tag,
        description: 'Invisible element with high z-index and active pointer-events is overlaying the viewport and intercepting clicks.'
      });
    }
  }

  // Check 2: Unnamed interactive controls (missing accessibility label)
  const emptyControlRegex = /<(button|input|select|textarea)(\s+[^>]*?)?>(?:(.*?)<\/\1>|)/gis;
  while ((match = emptyControlRegex.exec(html)) !== null) {
    const tag = match[1];
    const attrs = match[2] || '';
    const inner = (match[3] || '').replace(/<[^>]+>/g, '').trim();

    const hasAria = /aria-label=/i.test(attrs) || /aria-labelledby=/i.test(attrs);
    const hasPlaceholder = /placeholder=/i.test(attrs);
    const hasText = inner.length > 0;
    const isHidden = /type=["']hidden["']/i.test(attrs) || /aria-hidden=["']true["']/i.test(attrs);

    if (!isHidden && !hasAria && !hasPlaceholder && !hasText) {
      traps.push({
        kind: 'unnamed_interactive_control',
        severity: 'high',
        tag,
        description: `Interactive <${tag}> has no visible label or aria-label attribute. Click intent is ambiguous for users and AI agents.`
      });
    }
  }

  return {
    trapCount: traps.length,
    clean: traps.length === 0,
    traps
  };
}
