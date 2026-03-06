/**
 * Reads the auth token from the URL query parameter ?token=...
 * The token is passed through to all API requests automatically.
 */
export function useAuthToken() {
  const route = useRoute();

  const token = computed(() => {
    const t = route.query.token;
    return typeof t === 'string' ? t : '';
  });

  return { token };
}
