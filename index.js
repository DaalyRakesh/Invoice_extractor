require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// ─── Config ───────────────────────────────────────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-2.0-flash-001";

const SUPPORTED_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

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

// ─── OpenRouter API Call ──────────────────────────────────────────────────────

async function extractInvoiceData(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = SUPPORTED_TYPES[ext];

  if (!mimeType) {
    throw new Error(`Unsupported file type: ${ext}. Supported: ${Object.keys(SUPPORTED_TYPES).join(", ")}`);
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const imageBuffer = fs.readFileSync(filePath);
  const base64Image = imageBuffer.toString("base64");

  console.log(`    Key loaded: ${OPENROUTER_API_KEY ? OPENROUTER_API_KEY.substring(0, 20) + "..." : "NOT FOUND - check .env file"}`);

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
              {
                type: "text",
                text: buildPrompt(),
              },
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
    const detail = err.response?.data?.error?.message || JSON.stringify(err.response?.data) || err.message;
    throw new Error(`API Error ${status}: ${detail}`);
  }

  const rawContent = response.data.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error("No content returned from OpenRouter API");
  }

  let cleaned = rawContent.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Failed to parse AI response as JSON.\nRaw response:\n${rawContent.substring(0, 500)}`);
  }

  return parsed;
}

// ─── Process Files ────────────────────────────────────────────────────────────

async function processFile(filePath) {
  const fileName = path.basename(filePath);
  console.log(`\n Processing: ${fileName}`);

  try {
    console.log(`    Sending to AI model...`);
    const data = await extractInvoiceData(filePath);
    console.log(`    Done`);
    return { file: fileName, success: true, data };
  } catch (err) {
    console.log(`    Failed: ${err.message}`);
    return { file: fileName, success: false, error: err.message };
  }
}

async function processDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const files = fs.readdirSync(dirPath);
  const invoiceFiles = files
    .filter((f) => Object.keys(SUPPORTED_TYPES).includes(path.extname(f).toLowerCase()))
    .map((f) => path.join(dirPath, f));

  if (invoiceFiles.length === 0) {
    throw new Error(`No supported invoice images found in: ${dirPath}`);
  }

  console.log(` Found ${invoiceFiles.length} invoice file(s) in: ${dirPath}`);
  return invoiceFiles;
}

// ─── CLI & Main ──────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`
Usage:
  node index.js [options] <file(s)>

Options:
  --dir <path>   Process all invoice images in a directory
  --out <path>   Save JSON output to a file (default: print to console)
  --help         Show this help message

Examples:
  node index.js invoices/invoice_1.jpg
  node index.js invoices/invoice_1.jpg invoices/invoice_2.jpg
  node index.js --dir ./invoices
  node index.js --dir ./invoices --out results.json
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  if (!OPENROUTER_API_KEY) {
    console.error(" Error: OPENROUTER_API_KEY is not set in your .env file.");
    console.error("   Make sure .env file exists in this folder with:");
    console.error("   OPENROUTER_API_KEY=sk-or-v1-...");
    process.exit(1);
  }

  const isDirMode = args.includes("--dir");
  const outIndex = args.indexOf("--out");
  const outPath = outIndex !== -1 ? args[outIndex + 1] : null;

  const skipNext = new Set();
  if (isDirMode) skipNext.add(args.indexOf("--dir") + 1);
  if (outIndex !== -1) skipNext.add(outIndex + 1);

  const inputs = args.filter((a, i) => !a.startsWith("--") && !skipNext.has(i));

  console.log(" Invoice Data Extractor");
  console.log("─".repeat(50));

  let filePaths = [];

  if (isDirMode) {
    const dirIndex = args.indexOf("--dir");
    const dirPath = args[dirIndex + 1];
    if (!dirPath) {
      console.error(" --dir requires a path. Example: --dir ./invoices");
      process.exit(1);
    }
    filePaths = await processDirectory(dirPath);
  } else if (inputs.length > 0) {
    filePaths = inputs;
  } else {
    console.log("ℹ️  No input given. Trying ./invoices directory...");
    filePaths = await processDirectory("./invoices");
  }

  const results = [];
  for (let i = 0; i < filePaths.length; i++) {
    const result = await processFile(filePaths[i]);
    results.push(result);
  }

  const ok = results.filter((r) => r.success).length;
  console.log(`\n Processed ${results.length} file(s): ${ok} succeeded, ${results.length - ok} failed.`);

  const output = JSON.stringify(results.length === 1 ? results[0] : results, null, 2);

  if (outPath) {
    fs.writeFileSync(outPath, output, "utf-8");
    console.log(` Results saved to: ${path.resolve(outPath)}`);
  } else {
    console.log("\n" + "─".repeat(50));
    console.log(" RESULTS:");
    console.log("─".repeat(50));
    console.log(output);
  }
}

main().catch((err) => {
  console.error("\n Fatal error:", err.message || err);
  process.exit(1);
});
