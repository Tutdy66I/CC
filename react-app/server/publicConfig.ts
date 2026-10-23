/** Reject secret material before Vite embeds public configuration in JavaScript. */
export function validatePublishableKey(value: unknown): void {
  if (
    value !== undefined &&
    value !== '' &&
    (typeof value !== 'string' || !value.startsWith('sb_publishable_'))
  ) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY 仅允许 publishable key；构建已中止，配置值不会输出。',
    )
  }
}
