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

Analyse this image and provide exactly four things:

1. ALT TEXT: One short phrase or sentence (max 125 characters) that literally describes what the image shows, for screen readers. Be factual and specific. Do not start with "Image of" or "Photo of".

2. IMAGE DESCRIPTION: 2-3 sentences that describe the image in detail and explain what it shows IN THE CONTEXT of the written post below. Write in plain, natural language as if describing it to a colleague who cannot see it. The description will be appended to the LinkedIn post with the prefix "Image description:" so it should flow naturally as post content.${postContext}
3. TOO MUCH TEXT: Assess whether there is too much text in the image. Dense text in images is a common accessibility issue — hard to read on mobile and inaccessible to screen readers. Set found to true if more than ~20% of the image is covered by text, or if the text is very small or dense.

4. CONTRAST ISSUE: Assess whether text in the image has contrast issues — low contrast between text and background makes it hard to read for people with low vision. Set found to true if there are obvious contrast problems.

Respond in this exact JSON format with no other fields:
{
  "altText": "...",
  "imageDescription": "...",
  "tooMuchText": { "found": true, "detail": "..." },
  "contrastIssue": { "found": true, "detail": "..." }
}`;

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageData } },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    }
  );

  if (!geminiRes.ok) {
    const err = await geminiRes.text();
    return new Response(JSON.stringify({ error: 'Gemini error', detail: err }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const geminiJson = await geminiRes.json();
  const text = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;

  let parsed;
  try {
    parsed = JSON.parse(text);
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
