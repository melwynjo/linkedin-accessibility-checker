export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { imageData, mimeType, postText } = body;
  if (!imageData || !mimeType) {
    return new Response(JSON.stringify({ error: 'Missing imageData or mimeType' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const postContext = postText
    ? `\n\nThe LinkedIn post this image will accompany is:\n---\n${postText.slice(0, 2000)}\n---\n`
    : '';

  const prompt = `You are an accessibility expert helping someone write a LinkedIn post.

Analyse this image and provide exactly two things:

1. ALT TEXT: One short phrase or sentence (max 125 characters) that literally describes what the image shows, for screen readers. Be factual and specific. Do not start with "Image of" or "Photo of".

2. IMAGE DESCRIPTION: 2-3 sentences that describe the image in detail and explain what it shows IN THE CONTEXT of the written post below. Write in plain, natural language as if describing it to a colleague who cannot see it. The description will be appended to the LinkedIn post with the prefix "Image description:" so it should flow naturally as post content.${postContext}

Respond in this exact JSON format with no other fields:
{
  "altText": "...",
  "imageDescription": "..."
}`;

  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;
  const geminiBody = JSON.stringify({
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: imageData } },
      ],
    }],
  });

  let geminiRes = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: geminiBody,
  });

  // One retry after 2 s if rate-limited
  if (geminiRes.status === 429) {
    await new Promise(r => setTimeout(r, 2000));
    geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: geminiBody,
    });
  }

  if (!geminiRes.ok) {
    const err = await geminiRes.text();
    console.error(`Gemini API error: status=${geminiRes.status} body=${err.slice(0, 800)}`);
    return new Response(JSON.stringify({ error: 'Gemini error', status: geminiRes.status, detail: err }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const geminiJson = await geminiRes.json();
  const text = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;

  let parsed;
  try {
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    return new Response(JSON.stringify({ error: 'Could not parse Gemini response', raw: text }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
