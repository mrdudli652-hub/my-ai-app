import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  try {
    const { messages = [] } = req.body || {};

    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is missing");
    }

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is missing");
    }

    const sql = neon(process.env.DATABASE_URL);
    const userId = "samanai-user";

    // =====================================================
    // 1. دڵنیابوون لە بوونی خشتەی Memory
    // =====================================================

    await sql`
      CREATE TABLE IF NOT EXISTS public.memories (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        memory TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // =====================================================
    // 2. دوا نامەی بەکارهێنەر
    // =====================================================

    const lastMessage =
      messages[messages.length - 1]?.content || "";

    const cleanMessage = String(lastMessage).trim();

    // =====================================================
    // 3. دۆزینەوەی ناوی بەکارهێنەر
    // =====================================================

    let detectedName = null;

    const nameMatch = cleanMessage.match(
      /(?:ناوم|ناوی من)\s+(?:ـ)?([^\s،,.!؟]+)/
    );

    if (nameMatch) {
      detectedName = nameMatch[1]
        .replace(/[،,.!؟]+$/g, "")
        .replace(/^(?:ـ)/, "");

      // لابردنی "ە" ـی کۆتایی لە "سامانە"
      if (detectedName.endsWith("ە")) {
        detectedName = detectedName.slice(0, -1);
      }
    }

    // =====================================================
    // 4. پشکنینی داواکاریی Memory
    // =====================================================

    const memoryRequest =
      /لەبیرت بێت|لەبیرم بکە|بیرت بێت|لەبیرت نەچێت|تۆمار بکە|پاشەکەوتی بکە/i.test(
        cleanMessage
      );

    // =====================================================
    // 5. هەڵگرتنی ناو بە شێوەی تایبەت
    // =====================================================

    if (detectedName) {
      const nameMemory = `ناوی بەکارهێنەر: ${detectedName}`;

      const existingName = await sql`
        SELECT id
        FROM public.memories
        WHERE user_id = ${userId}
          AND memory = ${nameMemory}
        LIMIT 1
      `;

      if (existingName.length === 0) {
        await sql`
          INSERT INTO public.memories (user_id, memory)
          VALUES (${userId}, ${nameMemory})
        `;
      }
    }

    // =====================================================
    // 6. هەڵگرتنی Memory ـی داواکراو
    // =====================================================

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
          INSERT INTO public.memories (user_id, memory)
          VALUES (${userId}, ${cleanMessage})
        `;
      }
    }

    // =====================================================
    // 7. خوێندنەوەی هەموو Memory ـەکان
    // =====================================================

    const memoryRows = await sql`
      SELECT memory
      FROM public.memories
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
    `;

    const memories = memoryRows
      .map((row) => row.memory)
      .join("\n");

    const memoryText = memories
      ? memories
      : "هیچ Memory ـێک هێشتا تۆمار نەکراوە.";

    // =====================================================
    // 8. ڕێنمایی تایبەت بۆ SamanAI
    // =====================================================

    const systemInstruction = {
      parts: [
        {
          text:
            `تۆ SamanAI ـیت، یاریدەدەری زیرەکی بەکارهێنەر.

ئەمە Memory ـە ڕاستەقینەکانی بەکارهێنەرن:
${memoryText}

ڕێساکانی Memory:
1. ئەگەر لە Memory ـدا ناوی بەکارهێنەر هەیە، بە هەمان ناو بانگی بکە.
2. ئەگەر ناوی بەکارهێنەر لە Memory ـدا هەیە، هەرگیز مەڵێ "ناوت نازانم" یان "هیچ زانیارییەک نییە".
3. Memory ـەکان بە ڕاستی وەک زانیاریی پێشووی بەکارهێنەر مامەڵەیان لەگەڵ بکە.
4. هیچ Memory ـێک مەگۆڕە یان مەسڕەوە، مەگەر بەکارهێنەر بە ڕوونی داوای سڕینەوە بکات.
5. ئەگەر Memory پەیوەندیدار بە پرسیارەکەی بەکارهێنەر هەیە، بە شێوەی سروشتی بەکاری بهێنە.
6. ئەگەر Memory پەیوەندیدار نییە، پێویست نییە باسی بکەیت.

وەڵامەکانت بە کوردیی سۆرانی و سروشتی بن.`
        }
      ]
    };

    // =====================================================
    // 9. ناردنی گفتوگۆ + Memory بۆ Gemini
    // =====================================================

    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        {
          text: String(m.content || "")
        }
      ]
    }));

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction,
          contents
        })
      }
    );

    const data = await response.json();

    // =====================================================
    // 10. پشکنینی هەڵەی Gemini
    // =====================================================

    if (!response.ok) {
      console.error("GEMINI ERROR:", data);

      return res.status(response.status).json({
        error:
          data.error?.message ||
          "Gemini API error"
      });
    }

    // =====================================================
    // 11. وەرگرتنی وەڵامی AI
    // =====================================================

    const reply =
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("") ||
      "No response received.";

    return res.status(200).json({
      reply
    });

  } catch (error) {
    console.error("SERVER ERROR:", error);

    return res.status(500).json({
      error: error.message || "Server error"
    });
  }
}
