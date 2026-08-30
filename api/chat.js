import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  try {
    const { messages = [], userId: incomingUserId } = req.body || {};

    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is missing");
    }

    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is missing");
    }

    const sql = neon(process.env.DATABASE_URL);

    // هەمان User ID ـی پێشووتر، بۆ پاراستنی Memory ـەکانی کۆن
    const userId = String(
      incomingUserId || "samanai-user"
    ).trim();

    // =====================================================
    // 1. دڵنیابوون لە بوونی Memory table
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

    const cleanMessage =
      String(lastMessage).trim();

    // =====================================================
    // 3. دۆزینەوەی ناو
    // =====================================================

    let detectedName = null;

    const nameMatch = cleanMessage.match(
      /(?:ناوم|ناوی من)\s+(?:ـ)?([^\s،,.!؟]+)/
    );

    if (nameMatch) {
      detectedName = nameMatch[1]
        .replace(/[،,.!؟]+$/g, "")
        .replace(/^(?:ـ)/, "");

      if (detectedName.endsWith("ە")) {
        detectedName =
          detectedName.slice(0, -1);
      }
    }

    // =====================================================
    // 4. داواکاری Memory
    // =====================================================

    const memoryRequest =
      /لەبیرت بێت|لەبیرم بکە|بیرت بێت|لەبیرت نەچێت|تۆمار بکە|پاشەکەوتی بکە/i.test(
        cleanMessage
      );

    // =====================================================
    // 5. هەڵگرتنی ناو
    // =====================================================

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
          INSERT INTO public.memories
            (user_id, memory)
          VALUES
            (${userId}, ${cleanMessage})
        `;
      }
    }

    // =====================================================
    // 7. خوێندنەوەی Memory
    // =====================================================

    const memoryRows = await sql`
      SELECT memory
      FROM public.memories
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
    `;

    const memories =
      memoryRows
        .map((row) => row.memory)
        .join("\n");

    const memoryText =
      memories ||
      "هیچ Memory ـێک هێشتا تۆمار نەکراوە.";

    // =====================================================
    // 8. System Instruction
    // =====================================================

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

    // =====================================================
    // 9. گفتوگۆ
    // =====================================================

    const contents = messages.map((m) => ({
      role:
        m.role === "assistant"
          ? "assistant"
          : "user",

      content: String(m.content || "")
    }));

    // =====================================================
    // 10. OpenRouter
    // =====================================================

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${process.env.OPENROUTER_API_KEY}`,
         
