async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }
  return payload;
}

export async function fetchPublicState() {
  const response = await fetch('/api/v1/public-state', {
    credentials: 'same-origin'
  });

  return parseResponse(response);
}
