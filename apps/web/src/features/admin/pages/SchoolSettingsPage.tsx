import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  LOGO_PATH_PATTERN,
  SchoolSettingsUpdateSchema,
  type SchoolSettingsUpdate,
  type SchoolSettingsView,
} from '@ttlmhss/shared';
import { Panel } from '../../../components/layout/Page';
import {
  Alert,
  Button,
  ErrorState,
  LoadingState,
  TextAreaField,
  TextField,
  useToast,
} from '../../../components/ui';
import { DEFAULT_BRANDING } from '../../../brand/brand';
import { useRefreshBranding } from '../../../brand/BrandingProvider';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { useResource } from '../../../lib/use-resource';
import { AdminLayout } from '../AdminLayout';
import { adminHref } from '../admin-pages';
import { schoolSettings } from '../api';
import styles from '../admin.module.css';

type Values = Record<keyof SchoolSettingsUpdate, string>;
const FIELDS: (keyof Values)[] = [
  'fullName',
  'shortName',
  'motto',
  'principalName',
  'address',
  'phone',
  'email',
  'website',
  'logoUrl',
];

const toValues = (s: SchoolSettingsView): Values =>
  Object.fromEntries(FIELDS.map((f) => [f, s[f] ?? ''])) as Values;

export function SchoolSettingsPage() {
  const settings = useResource('school-settings', (signal) => schoolSettings.get(signal));
  return (
    <AdminLayout page="settings">
      {settings.status === 'loading' && <LoadingState />}
      {settings.status === 'error' && (
        <ErrorState message={settings.error} onRetry={settings.reload} />
      )}
      {settings.status === 'ready' && (
        <SettingsForm initial={settings.data} onSaved={settings.replace} />
      )}
    </AdminLayout>
  );
}

function SettingsForm({
  initial,
  onSaved,
}: {
  initial: SchoolSettingsView;
  onSaved: (s: SchoolSettingsView) => void;
}) {
  const [values, setValues] = useState<Values>(() => toValues(initial));
  const form = useFormSubmit(FIELDS);
  const toast = useToast();
  const refreshBranding = useRefreshBranding();
  const officialLogo = DEFAULT_BRANDING.logoUrl;

  const field = (name: keyof Values) => ({
    value: values[name],
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [name]: e.target.value })),
    error: form.errors[name],
    disabled: form.pending,
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const body = form.check(SchoolSettingsUpdateSchema, values);
    if (!body) return;
    const result = await form.run(() => schoolSettings.update(body));
    if (result.ok) {
      onSaved(result.value);
      setValues(toValues(result.value));
      refreshBranding();
      toast.show('School details saved');
    }
  }

  const logoValid = LOGO_PATH_PATTERN.test(values.logoUrl);

  return (
    <form onSubmit={onSubmit} noValidate className={styles.stack}>
      {form.formError && <Alert tone="error">{form.formError}</Alert>}
      <Panel
        title="Identity"
        description="Shown on the sign-in page, in the menu, on every page title and later on reports."
      >
        <div className={styles.formGrid}>
          <TextField
            label="School name"
            maxLength={150}
            autoComplete="organization"
            className={styles.span2}
            {...field('fullName')}
          />
          <TextField
            label="Short name"
            hint="Used where space is short, such as the menu and browser tab."
            maxLength={20}
            {...field('shortName')}
          />
          <TextField label="Motto" hint="Optional." maxLength={150} {...field('motto')} />
          <TextField
            label="Principal's name"
            hint="Optional. Used later for report signatures."
            maxLength={100}
            {...field('principalName')}
          />
        </div>
      </Panel>

      <Panel title="Contact details" description="Leave a field empty if it should not be shown.">
        <div className={styles.formGrid}>
          <TextAreaField
            label="Address"
            maxLength={500}
            className={styles.span2}
            {...field('address')}
          />
          <TextField label="Phone" type="tel" maxLength={60} {...field('phone')} />
          <TextField
            label="Email"
            type="email"
            maxLength={120}
            autoComplete="email"
            {...field('email')}
          />
          <TextField
            label="Website"
            type="url"
            maxLength={200}
            placeholder="https://"
            className={styles.span2}
            {...field('website')}
          />
        </div>
      </Panel>

      <Panel
        title="Logo and colour"
        description="The logo must be a file the app already serves from /brand/. Artwork is never edited here."
      >
        <div className={styles.stack}>
          <div className={styles.logoRow}>
            <span className={styles.logoPreview}>
              {logoValid ? (
                <img src={values.logoUrl} alt="Logo preview" width={96} height={96} />
              ) : (
                <span className={styles.muted}>No logo</span>
              )}
            </span>
            <div className={styles.logoFields}>
              <TextField label="Logo file" maxLength={200} {...field('logoUrl')} />
              {officialLogo && values.logoUrl !== officialLogo && (
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setValues((v) => ({ ...v, logoUrl: officialLogo }))}
                  >
                    Use the official logo
                  </Button>
                </div>
              )}
            </div>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Primary colour</dt>
              <dd>
                <span
                  className={styles.swatch}
                  style={{ background: initial.primaryColor }}
                  aria-hidden="true"
                />
                {initial.primaryColor.toUpperCase()} (fixed school colour)
              </dd>
            </div>
            <div>
              <dt>Current academic year</dt>
              <dd>
                {initial.currentAcademicYear ? (
                  initial.currentAcademicYear.label
                ) : (
                  <span className={styles.muted}>Not set</span>
                )}{' '}
                · <Link to={adminHref('years')}>Manage academic years</Link>
              </dd>
            </div>
          </dl>
        </div>
      </Panel>

      <div className={styles.formActions}>
        <Button type="submit" loading={form.pending} loadingLabel="Saving…">
          Save school details
        </Button>
        <Button
          variant="ghost"
          disabled={form.pending}
          onClick={() => {
            setValues(toValues(initial));
            form.reset();
          }}
        >
          Discard changes
        </Button>
      </div>
    </form>
  );
}
