# Apollo — Misinformation Detector

Chrome extension that detects misinformation in news articles in real time. It highlights suspicious sentences directly on the page with confidence scores and links to trusted sources covering the same topic.

> **Model**: The fine-tuned BERT model is not included in this repository.

---

## How it works

1. When you visit a news page, the extension sends the URL to a local Flask backend
2. `newspaper3k` extracts the article text; whitelisted sources (Reuters, BBC, NYT…) are skipped
3. Sentences are scored using fine-tuned BERT, VADER sentiment, and SBERT cosine similarity against factual references
4. Flagged segments are cross-checked via Serper API (Google News, 100+ trusted outlets)
5. Results are injected into the page — suspicious sentences highlighted in yellow with tooltips

## Structure

```
├── backend/
│   ├── server.py              # Flask API + analysis pipeline
│   ├── models.py              # BERT, SBERT, spaCy loading
│   ├── reliable_news_V2.py    # Fact-checking via Serper API
│   ├── config.yaml            # Thresholds, whitelist, model paths
│   └── patterns.yaml          # spaCy matcher patterns
└── frontend/                  # Chrome Extension (Manifest v3)
    ├── manifest.json
    ├── background.js           # Service worker
    ├── content.js              # Page injection + highlights
    └── popup.html/js           # Extension UI
```

## Stack

- **Backend**: Flask, fine-tuned BERT (`transformers`), SBERT (`all-mpnet-base-v2`), spaCy `en_core_web_trf`, NLTK VADER, `newspaper3k`, Serper API
- **Frontend**: Vanilla JS, Chrome Extensions API (MV3)

## Usage

```bash
pip install -r requirements.txt
python backend/server.py
```

Then load `frontend/` as an unpacked extension in Chrome (`chrome://extensions` → Load unpacked).

Configure model paths and thresholds in `backend/config.yaml`.

## Limitations

- The backend runs locally — the Flask server must be running for the extension to work
- Article extraction may fail on paywalled or JS-heavy pages
- Fact-checking is limited to articles from the past 15 days

## License

MIT
