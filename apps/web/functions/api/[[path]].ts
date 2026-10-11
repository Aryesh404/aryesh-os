interface Env {
  API_URL?: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const targetHost = (context.env.API_URL || 'http://localhost:4317').replace(/\/$/, '');
  const url = new URL(context.request.url);
  const subPath = url.pathname.replace(/^\/api/, '');
  const forwardUrl = `${targetHost}${subPath}${url.search}`;

  const response = await fetch(forwardUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.method !== 'GET' && context.request.method !== 'HEAD'
      ? context.request.body
      : undefined,
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
};
