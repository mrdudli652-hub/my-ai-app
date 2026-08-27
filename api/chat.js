async function redis(command) {
  const response = await fetch(process.env.KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Redis error");
  }

  return data.result;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages are required" });
    }

    const memoryKey = "samanai:memory:default";

    // Read previous memory
    const savedMemory = await redis(["GET", memoryKey]);

    const memoryText = savedMemory
      ? `\nImportant memory about the user:\n${savedMemory}\n`
      : "";

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text:
                "You are SamanAI, a helpful AI assistant. " +
                "Understand Kurdish Sorani and answer in the user's language. " +
                "Use the memory when useful." +
                memoryText
            }]
          },
          contents: messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
          }))
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "Gemini API error"
      });
    }

    const reply =
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("") ||
      "No response received.";

    // Save recent conversation as memory
    const recentMessages = messages
      .slice(-10)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    await redis([
      "SET",
      memoryKey,
      recentMessages,
      "EX",
      "2592000"
    ]);

    return res.status(200).json({ reply });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}
