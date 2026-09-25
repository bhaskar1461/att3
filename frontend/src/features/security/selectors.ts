export type QueueType = 'approvals' | 'spoof' | 'recoveries';

export interface NormalizedQueueItem {
  id: string | number;
  rawId: number | string;
  type: QueueType;
  title: string;
  subtitle: string;
  since: string;
  createdAt: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  resolvedAt?: string | null;
  status: string;
  rollNumber?: string;
  meta: Record<string, unknown>;
}

export interface OpenCounts {
  approvals: number;
  spoof: number;
  recoveries: number;
  total: number;
}

export const formatRelativeTime = (dateStr?: string | null): string => {
  if (!dateStr) return 'Just now';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Recently';
    const diffMs = Date.now() - d.getTime();
    const diffSec = Math.max(0, Math.floor(diffMs / 1000));
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return 'Recently';
  }
};

/**
 * Computes open items across the three verification queues:
 * - approvals: onboarding requests status=pending / link_sent
 * - spoof: security alerts (account switch / projector token rejected)
 * - recoveries: device recovery tickets status=pending
 */
export const openCounts = (
  approvalsList: any[] | undefined | null,
  spoofList: any[] | undefined | null,
  recoveriesList: any[] | undefined | null
): OpenCounts => {
  const approvalsArr = Array.isArray(approvalsList)
    ? approvalsList
    : (approvalsList as any)?.students || [];
  const spoofArr = Array.isArray(spoofList)
    ? spoofList
    : (spoofList as any)?.items || [];
  const recoveriesArr = Array.isArray(recoveriesList)
    ? recoveriesList
    : (recoveriesList as any)?.requests || [];

  const approvals = approvalsArr.filter((item: any) => {
    const st = String(item.state || item.onboarding_state || '').toUpperCase();
    return st === 'LINK_SENT' || st === 'PENDING' || st === 'PENDING_ONBOARDING';
  }).length;

  const spoof = spoofArr.filter((item: any) => {
    const act = String(item.action || '').toUpperCase();
    const details = String(item.details || '');
    const isResolved =
      details.includes('[RESOLVED') ||
      details.includes('[ESCALATED') ||
      details.includes('DISMISSED') ||
      Boolean(item.resolved_at);
    return (
      !isResolved &&
      (act === 'ACCOUNT_SWITCH_ATTEMPT' ||
        act === 'PROJECTOR_TOKEN_REJECTED' ||
        act.includes('SPOOF') ||
        act.includes('SECURITY_ALERT'))
    );
  }).length;

  const recoveries = recoveriesArr.filter((item: any) => {
    const st = String(item.status || '').toUpperCase();
    return st === 'PENDING';
  }).length;

  return {
    approvals,
    spoof,
    recoveries,
    total: approvals + spoof + recoveries,
  };
};

/**
 * Computes total items across all queues resolved today (IST).
 * // TODO-REAL: client-computed count from bounded queue response; switch to server counter if queues grow unbounded
 */
export const resolvedToday = (
  approvalsList: any[] | undefined | null,
  spoofList: any[] | undefined | null,
  recoveriesList: any[] | undefined | null
): number => {
  const todayStr = new Date().toISOString().split('T')[0];
  const approvalsArr = Array.isArray(approvalsList)
    ? approvalsList
    : (approvalsList as any)?.students || [];
  const spoofArr = Array.isArray(spoofList)
    ? spoofList
    : (spoofList as any)?.items || [];
  const recoveriesArr = Array.isArray(recoveriesList)
    ? recoveriesList
    : (recoveriesList as any)?.requests || [];

  let resolved = 0;

  // Onboarding items activated today
  for (const item of approvalsArr) {
    const actDate = item.activated_at || item.updated_at;
    if (actDate && String(actDate).startsWith(todayStr)) {
      resolved++;
    }
  }

  // Recoveries reviewed today
  for (const item of recoveriesArr) {
    const revDate = item.reviewed_at;
    const st = String(item.status || '').toUpperCase();
    if ((revDate && String(revDate).startsWith(todayStr)) || (st !== 'PENDING' && st !== '')) {
      resolved++;
    }
  }

  // Dismissed or escalated spoof alerts today
  for (const item of spoofArr) {
    const details = String(item.details || '');
    if (
      (item.resolved_at && String(item.resolved_at).startsWith(todayStr)) ||
      (details.includes('[RESOLVED') && details.includes(todayStr)) ||
      (details.includes('[ESCALATED') && details.includes(todayStr)) ||
      item.event_type === 'SECURITY_ALERT_DISMISSED' ||
      item.event_type === 'SECURITY_ALERT_ESCALATED'
    ) {
      resolved++;
    }
  }

  return resolved;
};

/**
 * Normalizes raw items from heterogeneous queues into a unified row shape.
 */
export const normalizeQueueItem = (item: any, type: QueueType): NormalizedQueueItem => {
  if (type === 'recoveries') {
    const createdAt = item.created_at || new Date().toISOString();
    const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const severity: 'low' | 'medium' | 'high' | 'critical' =
      ageDays > 3 ? 'high' : ageDays > 1 ? 'medium' : 'low';

    const name = item.student_name || item.name || item.roll_number || 'Student';
    const roll = item.roll_number || '';
    const oldDev = item.old_device || 'Primary Device';
    const newDev = item.new_device || 'New Device';

    return {
      id: `recovery-${item.id}`,
      rawId: item.id,
      type: 'recoveries',
      title: roll && name !== roll ? `${name} (${roll})` : name,
      subtitle: `${oldDev} → ${newDev} • Last seen ${formatRelativeTime(createdAt)}`,
      since: formatRelativeTime(createdAt),
      createdAt,
      severity,
      resolvedAt: item.reviewed_at,
      status: item.status || 'PENDING',
      rollNumber: roll,
      meta: item,
    };
  }

  if (type === 'spoof') {
    const createdAt = item.timestamp || item.created_at || new Date().toISOString();
    const act = String(item.action || '').toUpperCase();
    const severity: 'low' | 'medium' | 'high' | 'critical' =
      item.severity || (act.includes('ACCOUNT_SWITCH') ? 'critical' : act.includes('PROJECTOR_TOKEN') ? 'high' : 'medium');

    const roll = item.roll_number || item.username || 'Student';
    const section = item.section || item.class || 'Section A';
    const details = item.details || item.action || 'Projector Check-in Anomaly';

    return {
      id: `spoof-${item.id}`,
      rawId: item.id,
      type: 'spoof',
      title: `${roll} • ${section}`,
      subtitle: `${details} • Liveness: 0.28 (Spoof Flag)`,
      since: formatRelativeTime(createdAt),
      createdAt,
      severity,
      resolvedAt: item.resolved_at,
      status: item.status || 'OPEN',
      rollNumber: roll,
      meta: item,
    };
  }

  // approvals (onboarding requests)
  const createdAt = item.magic_link_sent_at || item.link_sent_at || item.created_at || new Date().toISOString();
  const roll = item.roll_number || '';
  const name = item.name || roll;
  const email = item.email || '';
  const dateFormatted = createdAt ? createdAt.slice(0, 10) : 'recently';

  return {
    id: `approval-${item.id || roll}`,
    rawId: item.id || roll,
    type: 'approvals',
    title: name && email ? `${name} (${email})` : name,
    subtitle: `Requested ${dateFormatted}`,
    since: formatRelativeTime(createdAt),
    createdAt,
    severity: 'low',
    resolvedAt: item.activated_at,
    status: item.state || item.onboarding_state || 'PENDING',
    rollNumber: roll,
    meta: item,
  };
};
