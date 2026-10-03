import { useEffect, useState } from 'react';
import {
  type AccountStatusView,
  type AcademicYearView,
  type ClassView,
  type EnrolmentStatus,
  type PlacementView,
  type StudentListItem,
  type TemporaryCredentialView,
} from '@ttlmhss/shared';
import { Copy, KeyRound } from 'lucide-react';
import { Alert, Badge, Button } from '../../components/ui';
import { useResource } from '../../lib/use-resource';
import { academicYears, classes } from '../admin/api';
import styles from './people.module.css';

/** Years and classes (with sections) used by the people screens' selectors. */
export function useSchoolStructure() {
  const years = useResource('academic-years', (signal) => academicYears.list(signal));
  const cls = useResource('classes', (signal) => classes.list(signal));
  return { years, classes: cls };
}

/** "IX A" style options for every section; inactive ones only when asked (e.g. filters). */
export function sectionOptions(list: readonly ClassView[], { includeInactive = false } = {}) {
  return list.flatMap((c) =>
    c.sections
      .filter((s) => includeInactive || (c.status === 'ACTIVE' && s.status === 'ACTIVE'))
      .map((s) => ({ value: s.id, label: `${c.name} ${s.name}`, classId: c.id })),
  );
}

export function yearOptions(list: readonly AcademicYearView[], { openOnly = false } = {}) {
  return list
    .filter((y) => !openOnly || y.status !== 'CLOSED')
    .map((y) => ({
      value: y.id,
      label: y.status === 'CURRENT' ? `${y.label} (current)` : y.label,
    }));
}

export const currentYear = (list: readonly AcademicYearView[]) =>
  list.find((y) => y.status === 'CURRENT') ?? list[0] ?? null;

export const placementLabel = (p: Pick<PlacementView, 'className' | 'sectionName'>) =>
  `${p.className} ${p.sectionName}`;

/** History wording: a TRANSFERRED row followed by another placement in the same year was a class change. */
export function placementStatusLabel(p: PlacementView, history: readonly PlacementView[]): string {
  const labels: Record<EnrolmentStatus, string> = {
    ACTIVE: 'Current',
    PROMOTED: 'Promoted',
    NOT_PROMOTED: 'Not promoted',
    TRANSFERRED: 'Transferred out',
    LEFT: 'Left school',
  };
  if (p.status === 'TRANSFERRED') {
    const moved = history.some(
      (o) =>
        o.enrolmentId !== p.enrolmentId &&
        o.academicYearId === p.academicYearId &&
        o.startedOn >= p.startedOn,
    );
    if (moved) return 'Moved to another class';
  }
  return labels[p.status];
}

export function StudentStatusBadge({
  student,
}: {
  student: Pick<StudentListItem, 'status' | 'exitReason'>;
}) {
  if (student.exitReason === 'TRANSFERRED') return <Badge tone="inactive">Transferred out</Badge>;
  if (student.exitReason === 'LEFT') return <Badge tone="inactive">Left school</Badge>;
  return student.status === 'ACTIVE' ? (
    <Badge tone="active">Active</Badge>
  ) : (
    <Badge tone="inactive">Inactive</Badge>
  );
}

export function AccountBadge({ account }: { account: AccountStatusView | null }) {
  if (!account) return <Badge tone="warning">No account</Badge>;
  if (account.status !== 'ACTIVE') return <Badge tone="inactive">Sign-in disabled</Badge>;
  if (account.mustChangePassword) return <Badge tone="warning">First sign-in pending</Badge>;
  return <Badge tone="active">Active</Badge>;
}

/** Debounced copy of a value (for search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/**
 * Shows a temporary password exactly once. It lives only in this component's props; closing the
 * dialog discards it. Never written to storage or logs.
 */
export function CredentialNotice({
  credential,
  name,
  onDone,
}: {
  credential: TemporaryCredentialView;
  name: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(credential.temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className={styles.credential} role="region" aria-label="Temporary password">
      <p className={styles.credentialTitle}>
        <KeyRound size={18} aria-hidden="true" /> Sign-in details for {name}
      </p>
      <dl className={styles.credentialFacts}>
        <div>
          <dt>Username</dt>
          <dd>
            <code>{credential.username}</code>
          </dd>
        </div>
        <div>
          <dt>Temporary password</dt>
          <dd>
            <code data-testid="temporary-password">{credential.temporaryPassword}</code>
          </dd>
        </div>
      </dl>
      <Alert tone="warning">
        This password is shown only now. Give it to {name} in person; they must choose their own
        password when they first sign in. Issuing a new one replaces it.
      </Alert>
      <div className={styles.credentialActions}>
        <Button
          variant="secondary"
          size="sm"
          icon={<Copy size={16} aria-hidden="true" />}
          onClick={() => void copy()}
        >
          {copied ? 'Copied' : 'Copy password'}
        </Button>
        <Button size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
