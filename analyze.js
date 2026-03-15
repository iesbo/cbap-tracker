export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { title, totalHours, rawDuties } = req.body;

    if (!title || !rawDuties || !totalHours) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Access the API key from Vercel's securely injected environment variables
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error("API Error: GEMINI_API_KEY is not defined.");
        return res.status(500).json({ error: 'Server configuration error' });
    }

    const promptText = `
Sen kıdemli bir CBAP mentorüsün. Adayın girdiği proje detaylarını BABOK v3 kurallarına ve IIBA Audit kriterlerine göre analiz et.
Proje Adı: ${title}
Toplam Saat: ${totalHours}
Adayın Yaptığı İşler (Ham): ${rawDuties}

Görevlerin:
1. Toplam ${totalHours} saati, adayın anlattığı işlere göre BABOK'un 6 Bilgi Alanına (bapm, ec, rlcm, sa, radd, se) adil ve uyumlu bir şekilde dağıt. Bu saatlerin tam toplamı mutlaka ${totalHours} olmalıdır.
2. Adayın anlattıklarını temel alarak, IIBA başvuru portalına doğrudan kopyalanabilecek, BABOK Action Verb'leri içeren "Audit-Proof" İNGİLİZCE bir açıklama (description) yaz. PM (Proje Yönetimi), Unit Test veya Kodlama kelimelerini BABOK terminolojisiyle değiştir.
3. Adaya bu projeyle ilgili TÜRKÇE mentor geribildirimleri ve varsa denetim (audit) risk uyarıları ver.
`;

    const payload = {
        contents: [{ parts: [{ text: promptText }] }],
        systemInstruction: { parts: [{ text: "Sen profesyonel bir CBAP mentorüsün. Çıktıların tamamen IIBA standartlarında olmalıdır." }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    kaDistribution: {
                        type: "OBJECT",
                        properties: {
                            bapm: { type: "INTEGER" },
                            ec: { type: "INTEGER" },
                            rlcm: { type: "INTEGER" },
                            sa: { type: "INTEGER" },
                            radd: { type: "INTEGER" },
                            se: { type: "INTEGER" }
                        },
                        required: ["bapm", "ec", "rlcm", "sa", "radd", "se"]
                    },
                    auditProofDescription: { type: "STRING" },
                    mentorFeedback: { type: "ARRAY", items: { type: "STRING" } }
                },
                required: ["kaDistribution", "auditProofDescription", "mentorFeedback"]
            }
        }
    };

    try {
        let targetModel = "models/gemini-2.5-flash";

        try {
            const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            if (modelsRes.ok) {
                const modelsData = await modelsRes.json();
                const availableModels = modelsData.models.filter(m =>
                    m.name.includes('gemini') &&
                    m.supportedGenerationMethods &&
                    m.supportedGenerationMethods.includes('generateContent')
                );

                if (availableModels.length > 0) {
                    const preferred = availableModels.find(m => m.name.includes('2.5-flash')) ||
                        availableModels.find(m => m.name.includes('1.5-flash')) ||
                        availableModels.find(m => m.name.includes('1.5-pro')) ||
                        availableModels.find(m => m.name.includes('gemini-2')) ||
                        availableModels[0];

                    targetModel = preferred.name;
                }
            }
        } catch (discoverErr) {
            console.warn("Could not fetch models list, using default model.");
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/${targetModel}:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Gemini API error ${response.status}: ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (resultText) {
            const parsed = JSON.parse(resultText);
            res.status(200).json(parsed);
        } else {
            throw new Error("No text returned from Gemini API");
        }
    } catch (error) {
        console.error("Proxy Error:", error);
        res.status(500).json({ error: 'Failed to process the request' });
    }
}
