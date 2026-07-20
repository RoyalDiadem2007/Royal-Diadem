/**
 * AvatarBuilder — the student composes her own avatar (SXU): a live portrait
 * preview above a row of facet pickers (skin, hair, hair colour, expression,
 * crown). Controlled: it owns no state, just reflects `config` and reports
 * every pick through `onChange`. Purely illustrated in-app — no photo, no
 * upload, nothing sent anywhere to render.
 */
import { AvatarCoin } from '@/components/student/AvatarCoin';
import { AVATAR_FACETS, type AvatarConfig, type AvatarFacetId } from '@/lib/avatarBuilder';

export function AvatarBuilder({
  config,
  onChange,
  disabled = false,
}: {
  config: AvatarConfig;
  onChange: (next: AvatarConfig) => void;
  disabled?: boolean;
}) {
  const pick = (facet: AvatarFacetId, key: string): void => {
    onChange({ ...config, [facet]: key });
  };

  return (
    <div className="avatar-builder">
      <div className="avatar-builder-preview">
        <AvatarCoin config={config} size={132} />
      </div>

      {AVATAR_FACETS.map((facet) => (
        <div className="avatar-facet" key={facet.id}>
          <span className="avatar-facet-label" id={`avatar-facet-${facet.id}`}>
            {facet.label}
          </span>
          <div
            className="avatar-swatches"
            role="radiogroup"
            aria-labelledby={`avatar-facet-${facet.id}`}
          >
            {facet.options.map((option) => {
              const selected = config[facet.id] === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${facet.label}: ${option.label}`}
                  className={selected ? 'avatar-swatch avatar-swatch-selected' : 'avatar-swatch'}
                  disabled={disabled}
                  onClick={() => {
                    pick(facet.id, option.key);
                  }}
                >
                  <span
                    className="avatar-swatch-dot"
                    style={{ backgroundColor: option.swatch }}
                    aria-hidden="true"
                  />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
