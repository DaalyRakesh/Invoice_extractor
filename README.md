# 🧾 Invoice Data Extractor

A Node.js project that extracts structured data from invoice images using OpenRouter AI — with a web frontend and automatic JSON saving.

---

## Prerequisites
- **Node.js** v18 or higher
- An **OpenRouter API key**

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure your API key
Create a `.env` file:
```
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

---

## Running

### Web Server (Frontend + Backend)
```bash
npm start
```
Then open **http://localhost:3000** in your browser.

- Upload one or multiple invoice images
- See extracted data instantly in a beautiful UI
- Results are automatically saved to the `results/` folder as JSON files



### CLI (Command Line)
```bash
node index.js invoices/invoice_1.jpg invoices/invoice_2.jpg
node index.js --dir ./invoices
node index.js --dir ./invoices --out output.json
```

---

## Project Structure
```
invoice-extractor/
├── server.js         # Express backend + API routes
├── index.js          # CLI script
├── public/
│   └── index.html    # Frontend UI
├── results/          # Extracted JSON files saved here automatically
├── uploads/          # Temp folder for uploaded files (auto-cleaned)
├── invoices/         # Place images here for CLI usage
├── .env              # Your API key
├── package.json
└── README.md
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/extract` | Extract single invoice |
| POST | `/api/extract-multiple` | Extract multiple invoices |
| GET | `/api/results` | List all saved results |

---

## Supported File Types
`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`
