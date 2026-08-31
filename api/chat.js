import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { messages = [], userId: incomingUserId } = req.body || {};

    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is missing");
    }

    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is missing");
    }

    const sql = neon(process.env.DATABASE_URL);

    const userId = String(
      incomingUserId || "samanai-user"
    ).trim();

    await sql`
      CREATE TABLE IF NOT EXISTS public.memories (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        memory TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const lastMessage =
      messages[messages.length - 1]?.content || "";

    const cleanMessage =
      String(lastMessage).trim();

    let detectedName = null;

    const nameMatch = cleanMessage.match(
      /(?:ناوم|ناوی من)\s+(?:ـ)?([^\s،,.!؟]+)/ 
    );

    if (nameMatch) {
      detectedName = nameMatch[1]
        .replace(/[،,.!؟]+$/g, "")
        .replace(/^ـ/, "");

      if (detectedName.endsWith("ە")) {
        detectedName = detectedName.slice(0, -1);
      }
    }

    const memoryRequest =
      /لەبیرت بێت|لەبیرم بکە|بیرت بێت|لەبیرت نەچێت|تۆمار بکە|پاشەکەوتی بکە/i
        .test(cleanMessage);

    if (detectedName) {
      const nameMemory =
        `ناوی بەکارهێنەر: ${detectedName}`;

      const existingName = await sql`
        SELECT id
        FROM public.memories
        WHERE user_id = ${userId}
          AND memory = ${nameMemory}
        LIMIT 1
      `;

      if (existingName.length === 0) {
        await sql`
          INSERT INTO public.memories
            (user_id, memory)
          VALUES
            (${userId}, ${nameMemory})
        `;
      }
    }

    if (
      memoryRequest &&
      cleanMessage &&
      !detectedName
    ) {
      const existingMemory = await sql`
        SELECT id
        FROM public.memories
        WHERE user_id = ${userId}
          AND memory = ${cleanMessage}
        LIMIT 1
      `;

      if (existingMemory.length === 0) {
        await sql`
          INSERT INTO public.memories
            (user_id, memory)
          VALUES
            (${userId}, ${cleanMessage})
        `;
      }
    }

    const memoryRows = await sql`
      SELECT memory
      FROM public.memories
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
    `;

    const memories = memoryRows
      .map((row) => row.memory)
      .join("\n");

    const memoryText =
      memories ||
      "هیچ Memory ـێک هێشتا تۆمار نەکراوە.";

    const systemPrompt = `
تۆ SamanAI ـیت، یاریدەدەری زیرەکی بەکارهێنەر.

ئەمە Memory ـەکانی ئەم بەکارهێنەرەن:

${memoryText}

ڕێساکانی Memory:

1. ئەگەر ناوی بەکارهێنەر لە Memory ـدا هەیە، بە هەمان ناو بانگی بکە.
2. هەرگیز مەڵێ ناوی بەکارهێنەر نازانیت ئەگەر لە Memory ـدا هەیە.
3. Memory ـەکان وەک زانیاریی پێشووی بەکارهێنەر بەکاربهێنە.
4. هیچ Memory ـێک مەسڕەوە یان مەگۆڕە، مەگەر بەکارهێنەر بە ڕوونی داوای ئەوە بکات.
5. Memory ـی بەکارهێنەرێکی تر بەکارمەهێنە.
6. ئەگەر Memory پەیوەندیدار نییە، باسی مەکە.
7. هەموو وەڵامەکان بە کوردیی سۆرانی و سروشتی بن.
`;

    const contents = messages
      .filter((m) => m && m.content)
      .map((m) => ({
        role: m.role === "assistant"
          ? "assistant"
          : "user",
        content: String(m.content)
      }));

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer":
            "https://my-ai-i04dqhlm8-saman-aig.vercel.app/",
          "X-Title": "SamanAI"
        },
        body: JSON.stringify({
          model: "openrouter/free",
        messages: [
  {
    role: "system",
    content: systemPrompt
  },
  ...contents
],
temperature: 0.7,
          max_tokens: 1200
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenRouter error:", data);

      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "AI request failed"
      });
    }

    const reply =
      data?.choices?.[0]?.message?.content;

    if (!reply) {
      console.error("Invalid AI response:", data);

      return res.status(502).json({
        error: "AI وەڵامێکی دروستی نەگەڕاندەوە."
      });
    }

    return res.status(200).json({
      reply: String(reply),
      userId
    });

  } catch (error) {
    console.error("SamanAI API error:", error);

    return res.status(500).json({
      error:
        error?.message ||
        "هەڵەیەکی نەخوازراو ڕوویدا."
    });
  }
}
