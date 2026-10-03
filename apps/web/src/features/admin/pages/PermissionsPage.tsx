import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  CONFIGURABLE_ROLES,
  PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_INFO,
  ROLE_DISPLAY_NAMES,
  type ConfigurableRole,
  type Permission,
  type PermissionsView,
} from '@ttlmhss/shared';
import { Lock, ShieldCheck } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Alert,
  Button,
  CheckboxField,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  useToast,
} from '../../../components/ui';
import { messageOf, useResource } from '../../../lib/use-resource';
import { AdminLayout } from '../AdminLayout';
import { permissions as api } from '../api';
import styles from '../admin.module.css';

const ROLE_HELP: Record<ConfigurableRole, string> = {
  TEACHER:
    'Every teacher account. Records are still limited to the teacher’s own periods and subjects.',
  CLASS_TEACHER:
    'Added to a teacher’s permissions only while they are class teacher of a section, and only for that section.',
  STUDENT: 'Student accounts. Students only ever see their own records.',
};

export function PermissionsPage() {
  const view = useResource('permissions', (signal) => api.get(signal));
  return (
    <AdminLayout
      page="permissions"
      description="Choose what each role may do. Each role has a fixed upper limit, so administrator powers can never be given to teachers or students. The server checks every action against these settings."
    >
      {view.status === 'loading' && <LoadingState />}
      {view.status === 'error' && <ErrorState message={view.error} onRetry={view.reload} />}
      {view.status === 'ready' && <PermissionsEditor view={view.data} onSaved={view.replace} />}
    </AdminLayout>
  );
}

function PermissionsEditor({
  view,
  onSaved,
}: {
  view: PermissionsView;
  onSaved: (v: PermissionsView) => void;
}) {
  const [role, setRole] = useState<ConfigurableRole>('TEACHER');
  const [drafts, setDrafts] = useState<Record<ConfigurableRole, Set<Permission>>>(
    () =>
      Object.fromEntries(view.roles.map((r) => [r.role, new Set(r.effective)])) as Record<
        ConfigurableRole,
        Set<Permission>
      >,
  );
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const tabRefs = useRef<Partial<Record<ConfigurableRole, HTMLButtonElement | null>>>({});

  const info = view.roles.find((r) => r.role === role)!;
  const draft = drafts[role];
  const saved = new Set(info.effective);
  const defaults = new Set(info.defaults);
  const ceiling = new Set(info.grantable);
  const inheritedFromTeacher =
    role === 'CLASS_TEACHER'
      ? new Set(view.roles.find((r) => r.role === 'TEACHER')!.effective)
      : new Set<Permission>();

  const added = PERMISSIONS.filter((p) => draft.has(p) && !saved.has(p));
  const removed = PERMISSIONS.filter((p) => !draft.has(p) && saved.has(p));
  const dirty = added.length + removed.length > 0;
  const atDefaults = draft.size === defaults.size && [...draft].every((p) => defaults.has(p));

  const toggle = (p: Permission, on: boolean) =>
    setDrafts((all) => {
      const next = new Set(all[role]);
      if (on) next.add(p);
      else next.delete(p);
      return { ...all, [role]: next };
    });

  async function save() {
    setSaving(true);
    try {
      const result = await api.setRole(
        role,
        PERMISSIONS.filter((p) => draft.has(p)),
      );
      onSaved(result);
      const fresh = result.roles.find((r) => r.role === role)!;
      setDrafts((all) => ({ ...all, [role]: new Set(fresh.effective) }));
      toast.show(`${ROLE_DISPLAY_NAMES[role]} permissions saved`);
      setConfirming(false);
    } catch (error) {
      toast.show(messageOf(error), 'error');
    } finally {
      setSaving(false);
    }
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const index = CONFIGURABLE_ROLES.indexOf(role);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % CONFIGURABLE_ROLES.length;
    if (event.key === 'ArrowLeft')
      next = (index - 1 + CONFIGURABLE_ROLES.length) % CONFIGURABLE_ROLES.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = CONFIGURABLE_ROLES.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = CONFIGURABLE_ROLES[next]!;
    setRole(target);
    tabRefs.current[target]?.focus();
  }

  return (
    <>
      <Panel title="Administrator">
        <p className={styles.adminNote}>
          <ShieldCheck size={18} aria-hidden="true" />
          Administrators always have every permission ({view.admin.length}). This cannot be changed,
          so the school can never be locked out of its own settings.
        </p>
      </Panel>

      <Panel>
        <div role="tablist" aria-label="Role" className={styles.tabs}>
          {CONFIGURABLE_ROLES.map((r) => {
            const changed = (() => {
              const s = new Set(view.roles.find((x) => x.role === r)!.effective);
              const d = drafts[r];
              return d.size !== s.size || [...d].some((p) => !s.has(p));
            })();
            return (
              <button
                key={r}
                ref={(el) => {
                  tabRefs.current[r] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${r}`}
                aria-selected={role === r}
                aria-controls={`panel-${r}`}
                tabIndex={role === r ? 0 : -1}
                className={styles.tab}
                onClick={() => setRole(r)}
                onKeyDown={onTabKey}
              >
                {ROLE_DISPLAY_NAMES[r]}
                {changed && (
                  <span className={styles.changed}>
                    {' '}
                    •<span className="visually-hidden"> (unsaved changes)</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`panel-${role}`}
          aria-labelledby={`tab-${role}`}
          className={`${styles.stack} ${styles.tabPanel}`}
        >
          <p className={styles.muted}>{ROLE_HELP[role]}</p>
          <div className={styles.permGroups}>
            {PERMISSION_GROUPS.map((group) => {
              const perms = PERMISSIONS.filter((p) => PERMISSION_INFO[p].group === group);
              return (
                <fieldset key={group} className={styles.fieldset}>
                  <legend className={styles.legend}>{group}</legend>
                  <div className={styles.permList}>
                    {perms.map((p) => {
                      const allowed = ceiling.has(p);
                      const inherited = inheritedFromTeacher.has(p);
                      const checked = inherited || draft.has(p);
                      const differs = allowed && !inherited && draft.has(p) !== defaults.has(p);
                      let note: ReactNode = null;
                      if (!allowed) {
                        note = (
                          <span className={styles.permNote}>
                            <Lock size={12} aria-hidden="true" />
                            {PERMISSION_INFO[p].grantableTo.length === 0
                              ? 'Administrators only'
                              : `Not available to ${ROLE_DISPLAY_NAMES[role].toLowerCase()}s`}
                          </span>
                        );
                      } else if (inherited) {
                        note = <span className={styles.permNote}>Included as a teacher</span>;
                      } else if (differs) {
                        note = (
                          <span className={`${styles.permNote} ${styles.changed}`}>
                            {draft.has(p)
                              ? 'Added (not in the defaults)'
                              : 'Removed (on by default)'}
                          </span>
                        );
                      }
                      return (
                        <CheckboxField
                          key={p}
                          label={PERMISSION_INFO[p].label}
                          hint={note}
                          checked={checked}
                          disabled={!allowed || inherited || saving}
                          onChange={(e) => toggle(p, e.target.checked)}
                        />
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
          </div>
          {dirty && (
            <Alert tone="warning">
              Unsaved changes for {ROLE_DISPLAY_NAMES[role]}: {added.length} added, {removed.length}{' '}
              removed.
            </Alert>
          )}
          <div className={`${styles.formActions} ${styles.flush}`}>
            <Button disabled={!dirty} onClick={() => setConfirming(true)}>
              Save {ROLE_DISPLAY_NAMES[role]} permissions
            </Button>
            <Button
              variant="secondary"
              disabled={atDefaults || saving}
              onClick={() => setDrafts((all) => ({ ...all, [role]: new Set(defaults) }))}
            >
              Reset to defaults
            </Button>
            {dirty && (
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => setDrafts((all) => ({ ...all, [role]: new Set(saved) }))}
              >
                Discard changes
              </Button>
            )}
          </div>
        </div>
      </Panel>

      <ConfirmDialog
        open={confirming}
        title={`Change ${ROLE_DISPLAY_NAMES[role]} permissions?`}
        confirmLabel="Save permissions"
        pending={saving}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      >
        <p>
          This applies to every {ROLE_DISPLAY_NAMES[role].toLowerCase()} from their next action.
        </p>
        {added.length > 0 && (
          <p>
            <span className={styles.strong}>Allow:</span>{' '}
            {added.map((p) => PERMISSION_INFO[p].label).join(', ')}
          </p>
        )}
        {removed.length > 0 && (
          <p>
            <span className={styles.strong}>Stop allowing:</span>{' '}
            {removed.map((p) => PERMISSION_INFO[p].label).join(', ')}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
