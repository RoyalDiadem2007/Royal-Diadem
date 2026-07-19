/**
 * The illustrated avatar vocabulary (SXU brief: no photograph required).
 * Keys are stable identifiers stored on student_profiles.avatar_key; the
 * medallion art lives in components/student/avatarArt.tsx.
 */
export const AVATAR_OPTIONS: readonly { key: string; label: string }[] = [
  { key: 'crown', label: 'Crown' },
  { key: 'sparkle', label: 'Sparkle' },
  { key: 'rose', label: 'Rose' },
  { key: 'gem', label: 'Gem' },
  { key: 'star', label: 'Star' },
  { key: 'heart', label: 'Heart' },
];

export function isAvatarKey(value: string): boolean {
  return AVATAR_OPTIONS.some((option) => option.key === value);
}
