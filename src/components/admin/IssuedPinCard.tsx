/**
 * One-time credential display after enrollment or a PIN reset. The PIN exists
 * only in this render — dismissing the card is the last time anyone sees it
 * (the server stores a bcrypt hash only). Nothing here touches storage.
 */
import type { IssuedCredentials } from '@/lib/adminStudents';

type Props = {
  issued: IssuedCredentials;
  reason: 'created' | 'reset';
  onDismiss: () => void;
};

export function IssuedPinCard({ issued, reason, onDismiss }: Props) {
  return (
    <div className="issued-pin-card" role="status">
      <h3 className="issued-pin-title">
        {reason === 'created'
          ? `${issued.student.displayName} is enrolled`
          : `New PIN for ${issued.student.displayName}`}
      </h3>
      <dl className="issued-pin-details">
        <div>
          <dt>Crown code</dt>
          <dd>{issued.student.loginCode ?? '—'}</dd>
        </div>
        <div>
          <dt>PIN</dt>
          <dd>{issued.pin}</dd>
        </div>
      </dl>
      <p className="issued-pin-warning">
        Write this on her card now — the PIN is shown only this once and can&rsquo;t be looked up
        later.
      </p>
      {reason === 'created' && issued.student.coppaRequired && (
        <p className="issued-pin-warning">
          She&rsquo;s under 13: her account stays locked until guardian consent is verified.
        </p>
      )}
      <button type="button" className="admin-retry-button" onClick={onDismiss}>
        Done — card written
      </button>
    </div>
  );
}
