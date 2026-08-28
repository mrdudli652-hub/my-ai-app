import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  try {
    const { messages = [] } = req.body || {};

    const sql = neon(process.env.DATABASE_URL);

    // ناسنامەی بەکارهێنەر بۆ Memory
    const userId = "samanai-user";

    // Memory ـەکانی پێشوو بخوێنەوە
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
      ? `Memory ـەکانی SamanAI:\n${memories}`
      : "هێشتا هیچ Memory ـێک نییە.";

    const contents = [
      {
        role: "user",
        parts: [
          {
            text:
              `تۆ SamanAI ـیت، یاریدەدەری زیرەکی بەکارهێنەر. ` +
              `ئەم Memory ـانە زانیارییەکانی پێشوون و لە وەڵامەکانتدا بە شێوەی سروشتی بەکاریان بهێنە.\n\n` +
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
  console.error("GEMINI ERROR:", JSON.stringify(data, null, 2));

  return res.status(500).json({
    error: data.error?.message || "Gemini API error",
    details: data
  });
}

    const reply =
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("") ||
      "No response received.";

    // ئەگەر بەکارهێنەر داوای لەبیرکردنی شتێک کرد
    const lastMessage =
      messages[messages.length - 1]?.content || "";

    const memoryRequest =
      /لەبیرت بێت|لەبیرم بکە|بیرت بێت|لەبیرت نەچێت/i.test(
        lastMessage
      );

    if (memoryRequest) {
      await sql`
        INSERT INTO memories (user_id, memory)
        VALUES (${userId}, ${lastMessage})
      `;
    }

    return res.status(200).json({ reply });

  } catch (error) {
    console.error(error);

        return res.status(500).json({
      error: error.message
    });
  }
}
