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
    const { messages, image, imageType } = req.body || {};

  

    const memoryKey = "samanai:memory:default";

    const savedMemory = await redis(["GET", memoryKey]);

    const memoryText = savedMemory
      ? `\nImportant memory about the user:\n${savedMemory}\n`
      : "";

    let contents;

    if (image) {
      const lastMessage =
        messages[messages.length - 1]?.content || "Analyze this image.";

      contents = [
        {
          role: "user",
          parts: [
            {
              text:
                lastMessage +
                "\n\nPlease analyze the attached image and answer in Kurdish Sorani."
            },
            {
              inline_data: {
                mime_type: imageType || "image/jpeg",
                data: image
              }
            }
          ]
        }
      ];
    } else {
      contents = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));
    }

    let response = await fetch(
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text:
              "You are SamanAI, a helpful AI assistant. " +
              "Understand Kurdish Sorani and answer in the user's language. " +
              "Use the memory when useful." +
              memoryText
          }
        ]
      },
      contents
    })
  }
);

let data = await response.json();

if (!response.ok && response.status === 429) {
  response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          {
            role: "system",
            content:
              "You are SamanAI. Answer in Kurdish Sorani when appropriate. " +
              "Be helpful and concise." +
              memoryText
          },
          {
            role: "user",
            content: "Please answer the user's request."
          }
        ]
      })
    }
  );

  data = await response.json();

  if (!response.ok) {
    return res.status(response.status).json({
      error: data.error?.message || "OpenRouter error"
    });
  }

  const reply =
    data.choices?.[0]?.message?.content ||
    "No response received.";

  return res.status(200).json({ reply });
}

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
