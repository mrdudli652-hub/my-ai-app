
import { timingSafeEqual } from "node:crypto";

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function verifySecret(provided, expected) {
  if (
    typeof provided !== "string" ||
    typeof expected !== "string"
  ) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  return (
    a.length === b.length &&
    timingSafeEqual(a, b)
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "Method not allowed");
  }

  const secret = process.env.AGENT_API_SECRET;
  const auth = req.headers.authorization || "";

  if (!secret) {
    return sendError(res, 503, "Agent is not configured.");
  }

  const provided = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : "";

  if (!verifySecret(provided, secret)) {
    return sendError(res, 401, "Unauthorized");
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return sendError(res, 503, "AI provider is missing.");
  }

  const goal =
    typeof req.body?.goal === "string"
      ? req.body.goal.trim()
      : "";

  if (!goal) {
    return sendError(res, 400, "Please provide a goal.");
  }

  if (goal.length > 4000) {
    return sendError(res, 413, "Goal is too long.");
  }

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "X-Title": "SAMAN AI AUTONOMOUS"
        },
        body: JSON.stringify({
          model: "openrouter/free",
          temperature: 0.2,
          max_tokens: 1400,
          messages: [
            {
              role: "system",
              content: `
تۆ مێشکی پلاندانانی SAMAN AI AUTONOMOUS یت.

هەموو وەڵامەکان بە کوردیی سۆرانی بن.

ئەرکی تۆ:
1. ئامانجی بەکارهێنەر تێبگە.
2. پلانێکی ڕوون دابنێ.
3. ئەرکەکە دابەش بکە بۆ هەنگاوەکان.
4. مەترسییەکان دیاری بکە.
5. پێش هەر کردارێکی دەرەکی مۆڵەت داوا بکە.

تەنها JSON ی دروست بگەڕێنەوە بەو شێوەیە:

{
 "summary": "پوختەی پلان",
 "steps": [
  {
   "id": 1,
   "title": "ناوی هەنگاو",
   "description": "ڕوونکردنەوە",
   "risk": "low",
   "requires_approval": true
  }
 ],
 "needs_user_input": [],
 "safety_notes": []
}

تەنها 1 تا 8 هەنگاو دروست بکە.
هەموو هەنگاوەکان پێویستیان بە مۆڵەتی بەکارهێنەر هەیە.
هیچ کردارێک جێبەجێ مەکە.
هیچ نهێنی، وشەی تێپەڕبوون یان کلیلێکی API مەخوازە.
`
            },
            {
              role: "user",
              content: goal
            }
          ]
        })
      }
    );

    const raw = await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return sendError(
        res, 502,
        "AI provider returned invalid data."
      );
    }

    if (!response.ok) {
      console.error(
        "OpenRouter error:",
        data?.error?.code || response.status
      );

      return sendError(
        res, 502,
        "AI service is temporarily unavailable."
      );
    }

    let content =
      data?.choices?.[0]?.message?.content;

    if (typeof content !== "string" || !content.trim()) {
      return sendError(res, 502, "Empty AI response.");
    }

    content = content.trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");

    let plan;

    try {
      plan = JSON.parse(content);
    } catch {
      return sendError(
        res, 502,
        "AI returned an unreadable plan."
      );
    }

    if (
      !plan ||
      typeof plan.summary !== "string" ||
      !Array.isArray(plan.steps) ||
      plan.steps.length > 8
    ) {
      return sendError(res, 502, "Invalid plan structure.");
    }

    const safePlan = {
      summary: plan.summary.slice(0, 1200),

      steps: plan.steps.map((step, index) => ({
        id: index + 1,
        title: String(step?.title || "هەنگاو").slice(0, 160),
        description: String(
          step?.description || ""
        ).slice(0, 700),

        risk: ["low", "medium", "high"].includes(step?.risk)
          ? step.risk
          : "medium",

        requires_approval: true
      })),

      needs_user_input: Array.isArray(plan.needs_user_input)
        ? plan.needs_user_input.slice(0, 6)
        : [],

      safety_notes: Array.isArray(plan.safety_notes)
        ? plan.safety_notes.slice(0, 6)
        : [],

      execution_status: "plan_only",
      approval_required: true
    };

    return res.status(200).json({
      plan: safePlan
    });

  } catch (error) {
    console.error(
      "SAMAN AI error:",
      error?.message || "Unknown error"
    );

    return sendError(
      res, 500,
      "Internal agent error."
    );
  }
}

