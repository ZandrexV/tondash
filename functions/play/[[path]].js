export async function onRequest(context) {
  return new Response('Function OK: ' + new URL(context.request.url).pathname, {
    headers: { 'Content-Type': 'text/plain' },
  });
}