/**
 * In-memory visit state for the home-screen prompts (passkey, push). Never
 * client storage — the no-PHI-client-side rule stays absolute; a reload
 * simply re-offers, which is the intended gentleness.
 */
export const promptMemory = {
  passkeyDismissed: false,
  pushDismissed: false,
  pushEnabled: false,
};

/** Test hook: mirrors resetAuthForTests so prompts reappear between tests. */
export function resetPromptMemoryForTests(): void {
  promptMemory.passkeyDismissed = false;
  promptMemory.pushDismissed = false;
  promptMemory.pushEnabled = false;
}
