const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function removeById(arr, id) {
  const idx = arr.findIndex(c => c.id === id);
  if (idx >= 0) { arr.splice(idx, 1); return true; }
  for (const c of arr) { if (c.replies && removeById(c.replies, id)) return true; }
  return false;
}

function addReply(arr, parentId, reply) {
  for (const c of arr) {
    if (c.id === parentId) { c.replies = c.replies || []; c.replies.push(reply); return true; }
    if (c.replies && addReply(c.replies, parentId, reply)) return true;
  }
  return false;
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const page = url.searchParams.get('page');
  if (!page) {
    const list = await context.env.COMMENTS_KV.list({ prefix: 'inline_' });
    const all = {};
    for (const key of list.keys) {
      all[key.name.replace('inline_', '')] = await context.env.COMMENTS_KV.get(key.name, 'json') || [];
    }
    return new Response(JSON.stringify(all), { headers: CORS });
  }
  const data = await context.env.COMMENTS_KV.get(`inline_${page}`, 'json') || [];
  return new Response(JSON.stringify(data), { headers: CORS });
}

export async function onRequestPost(context) {
  const body = await context.request.json();
  const page = body.page;
  if (!page) return new Response(JSON.stringify({ error: 'page required' }), { status: 400, headers: CORS });

  let comments = await context.env.COMMENTS_KV.get(`inline_${page}`, 'json') || [];

  switch (body.action) {
    case 'add':
      comments.unshift(body.comment);
      break;
    case 'reply':
      addReply(comments, body.parentId, body.reply);
      break;
    case 'delete':
      removeById(comments, body.id);
      break;
    case 'sync':
      if (Array.isArray(body.comments)) comments = body.comments;
      break;
  }

  await context.env.COMMENTS_KV.put(`inline_${page}`, JSON.stringify(comments));
  return new Response(JSON.stringify({ ok: true, comments }), { headers: CORS });
}
