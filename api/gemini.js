// Vercelのサーバーレス関数。Gemini APIキーをサーバー側に隠して呼び出す橋渡し役。
// APIキーはVercelの環境変数 GEMINI_API_KEY に設定してね（コードには書かない）。
//
// 呼び出し元（src/App.jsx）は今まで通り Anthropic 形式のレスポンス
// { content: [{ type: "text", text: "..." }] } を期待しているので、
// ここでGeminiのレスポンスをその形に変換して返してる。

const MODEL = "gemini-1.5-flash";
// 無料枠で使えるモデル名はGoogleがちょくちょく変更するから、
// もし動かなくなったら https://ai.google.dev/gemini-api/docs/models で
// 今の無料枠モデル名を確認してここを書き換えてね

function toGeminiParts(content) {
  // content は文字列 or Anthropic形式の配列（画像+テキストの組み合わせ）
  if (typeof content === "string") {
    return [{ text: content }];
  }
  return content.map((item) => {
    if (item.type === "image") {
      return { inline_data: { mime_type: item.source.media_type, data: item.source.data } };
    }
    return { text: item.text || "" };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("❌ エラー: GEMINI_API_KEY がVercelの環境変数に設定されていません。");
    res.status(500).json({ error: "GEMINI_API_KEY が設定されていないよ。Vercelの環境変数を確認してね。" });
    return;
  }

  try {
    const { system, messages, max_tokens } = req.body || {};

    const contents = (messages || []).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: toGeminiParts(m.content),
    }));

    // モデル名を変数 MODEL に連動させる
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    // デバッグ用：送信リクエストのログ
    console.log(`🚀 [Gemini Request] Model: ${MODEL}, Messages Count: ${contents.length}`);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        generationConfig: {
          maxOutputTokens: max_tokens || 1000,
          responseMimeType: "application/json",
        },
      }),
    });

    const data = await response.json();

    // Google APIからの応答が失敗（404, 400, 403など）だった場合
    if (!response.ok) {
      console.error("🔥 [Gemini API Error Detail]:", JSON.stringify(data, null, 2));
      res.status(response.status).json({ 
        error: data?.error?.message || "Gemini APIエラーが発生したよ",
        status: response.status,
        details: data
      });
      return;
    }

    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    
    // 成功ログ
    console.log("✅ [Gemini Response Success]");
    
    res.status(200).json({ content: [{ type: "text", text }] });
  } catch (e) {
    // サーバー内部や通信自体のクラッシュログ
    console.error("💥 [Server Internal Error]:", e);
    res.status(500).json({ 
      error: e.message || String(e),
      details: e.stack || e
    });
  }
}
