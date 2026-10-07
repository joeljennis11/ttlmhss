// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ConfirmDialog } from '../src/components/ui/ConfirmDialog';
import { FormDialog } from '../src/components/ui/Dialog';

/* Phase 12B accessibility fix: closing a dialog returns keyboard focus to the control that opened it. */
function Harness({ kind }: { kind: 'form' | 'confirm' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open it</button>
      {kind === 'form' ? (
        <FormDialog
          open={open}
          title="Edit"
          submitLabel="Save"
          onSubmit={() => setOpen(false)}
          onClose={() => setOpen(false)}
        >
          <input aria-label="Name" />
        </FormDialog>
      ) : (
        <ConfirmDialog
          open={open}
          title="Sure?"
          confirmLabel="Yes"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

describe('dialogs return focus to their opener', () => {
  it.each(['form', 'confirm'] as const)('%s dialog', async (kind) => {
    const u = userEvent.setup();
    render(<Harness kind={kind} />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    await u.click(opener);
    await u.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(document.activeElement).toBe(opener);
  });
});
