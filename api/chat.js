import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  try {
    const { messages = [] } = req.body || {};

    const sql = neon(process.env.DATABASE_URL);

    const userId = "samanai-user";

    // خوێندنەوەی Memory ـەکانی پێشوو
    const memoryRows = await sql`
      SELECT memory
      FROM memories
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
    `;

    const memories = memoryRows
      .map((row) => row.memory)
      .join("\n");

    const memoryText = memories
      ? `Memory ـەکانی بەکارهێنەر:\n${memories}`
      : "هیچ Memory ـێک هێشتا نییە.";

    // ناردنی Memory + گفتوگۆ بۆ Gemini
    const contents = [
      {
        role: "user",
        parts: [
          {
            text:
              `تۆ SamanAI ـیت، یاریدەدەری زیرەکی بەکارهێنەر. ` +
              `Memory ـەکانی خوارەوە زانیارییە پێشوون. ` +
              `کاتێک پەیوەندیدار بوون، بە شێوەی سروشتی بەکاریان بهێنە.\n\n` +
              memoryText
          }
        ]
      },
      ...messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }))
    ];

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("GEMINI ERROR:", data);

      return res.status(response.status).json({
        error: data.error?.message || "Gemini API error"
      });
    }

    const reply =
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("") ||
      "No response received.";

    // پشکنینی داوای Memory
    const lastMessage =
      messages[messages.length - 1]?.content || "";

    const memoryRequest =
      /لەبیرت بێت|لەبیرم بکە|بیرت بێت|لەبیرت نەچێت/i.test(
        lastMessage
      );

    // هەڵگرتنی Memory لە Neon
    if (memoryRequest && lastMessage.trim()) {
      await sql`
        INSERT INTO memories (user_id, memory)
        VALUES (${userId}, ${lastMessage})
      `;
    }

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
