const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const page = url.searchParams.get('page');
  if (!page) {
    return new Response(JSON.stringify({ error: 'page required' }), { status: 400, headers: CORS });
  }
  const data = await context.env.COMMENTS_KV.get(`votes_${page}`, 'json') || { likes: 0 };
  return new Response(JSON.stringify(data), { headers: CORS });
}

export async function onRequestPost(context) {
  const body = await context.request.json();
  const page = body.page;
  if (!page) {
    return new Response(JSON.stringify({ error: 'page required' }), { status: 400, headers: CORS });
  }

  const data = await context.env.COMMENTS_KV.get(`votes_${page}`, 'json') || { likes: 0 };

  switch (body.action) {
    case 'like':
      data.likes = (data.likes || 0) + 1;
      break;
    case 'unlike':
      data.likes = Math.max(0, (data.likes || 0) - 1);
      break;
  }

  await context.env.COMMENTS_KV.put(`votes_${page}`, JSON.stringify(data));
  return new Response(JSON.stringify({ ok: true, ...data }), { headers: CORS });
}
