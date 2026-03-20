require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

const app = express();
const PORT = 3000;

// ─── Config ───────────────────────────────────────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-2.0-flash-001";

const SUPPORTED_TYPES = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
};

// ─── Folders ──────────────────────────────────────────────────────────────────

const UPLOADS_DIR = path.join(__dirname, "uploads");
const RESULTS_DIR = path.join(__dirname, "results");

[UPLOADS_DIR, RESULTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Multer (file upload) ─────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (SUPPORTED_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type. Please upload JPG, PNG, GIF or WEBP."));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt() {
  return `You are an expert invoice data extractor. Extract ALL data from this invoice image and return it as a single valid JSON object.

Return ONLY the JSON — no markdown fences, no explanations, no extra text.

Use this exact structure:
{
  "vendor": {
    "name": "string",
    "address": "string (full address on one line, comma-separated)",
    "tax_id": "string",
    "iban": "string"
  },
  "client": {
    "name": "string",
    "address": "string (full address on one line, comma-separated)",
    "tax_id": "string"
  },
  "invoice_number": "string",
  "invoice_date": "YYYY-MM-DD",
  "totals": {
    "net_worth": number,
    "vat": number,
    "grand_total": number
  },
  "line_items": [
    {
      "description": "string",
      "quantity": number,
      "unit_of_measure": "string",
      "unit_price": number,
      "net_worth": number,
      "vat_percent": number,
      "line_total": number
    }
  ]
}

Rules:
- All monetary values must be numbers (not strings). Use dot as decimal separator.
- invoice_date must be in YYYY-MM-DD format.
- If a field is missing from the invoice, use null for strings and 0 for numbers.
- Extract every line item shown in the invoice items table.`;
}

// ─── Extract Invoice via OpenRouter ──────────────────────────────────────────

async function extractInvoice(filePath, mimeType) {
  const imageBuffer = fs.readFileSync(filePath);
  const base64Image = imageBuffer.toString("base64");

  let response;
  try {
    response = await axios.post(
      OPENROUTER_URL,
      {
        model: MODEL,
        max_tokens: 2048,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64Image}` },
              },
              { type: "text", text: buildPrompt() },
            ],
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://invoice-extractor.local",
          "X-Title": "Invoice Data Extractor",
        },
      }
    );
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.error?.message || err.message;
    throw new Error(`API Error ${status}: ${detail}`);
  }

  const rawContent = response.data.choices[0]?.message?.content;
  if (!rawContent) throw new Error("No content returned from API");

  let cleaned = rawContent.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("Failed to parse AI response as JSON");
  }
}

// ─── Save Result to results/ folder ──────────────────────────────────────────

function saveResult(filename, data) {
  const baseName = path.basename(filename, path.extname(filename));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultFile = path.join(RESULTS_DIR, `${baseName}_${timestamp}.json`);
  fs.writeFileSync(resultFile, JSON.stringify(data, null, 2), "utf-8");
  return path.basename(resultFile);
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────

// Upload & extract single invoice
app.post("/api/extract", upload.single("invoice"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: "No file uploaded" });
  }

  const filePath = req.file.path;
  const mimeType = SUPPORTED_TYPES[req.file.mimetype];
  const originalName = req.file.originalname;

  try {
    const data = await extractInvoice(filePath, mimeType);
    const savedFile = saveResult(originalName, {
      file: originalName,
      extracted_at: new Date().toISOString(),
      data,
    });

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      file: originalName,
      saved_as: savedFile,
      data,
    });
  } catch (err) {
    // Clean up uploaded file on error
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload & extract multiple invoices
app.post("/api/extract-multiple", upload.array("invoices", 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, error: "No files uploaded" });
  }

  const results = [];

  for (const file of req.files) {
    const mimeType = SUPPORTED_TYPES[file.mimetype];
    try {
      const data = await extractInvoice(file.path, mimeType);
      const savedFile = saveResult(file.originalname, {
        file: file.originalname,
        extracted_at: new Date().toISOString(),
        data,
      });
      results.push({ file: file.originalname, success: true, saved_as: savedFile, data });
    } catch (err) {
      results.push({ file: file.originalname, success: false, error: err.message });
    } finally {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
  }

  res.json({ success: true, results });
});

// List all saved results
app.get("/api/results", (req, res) => {
  const files = fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"));
  const results = files.map((f) => {
    const content = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), "utf-8"));
    return { filename: f, ...content };
  });
  res.json({ success: true, results });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n Invoice Extractor Server running at http://localhost:${PORT}`);
  console.log(` Results will be saved to: ${RESULTS_DIR}`);
  console.log(` API Key: ${OPENROUTER_API_KEY ? OPENROUTER_API_KEY.substring(0, 20) + "..." : "NOT SET"}\n`);
});
