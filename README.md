# Apollo — Misinformation Detector

Apollo is a Chrome extension that detects potential misinformation in news articles in real time. As you browse, it analyzes article content using a fine-tuned BERT model and NLP pipeline, then highlights suspicious sentences directly on the page with explanations and links to reliable sources.

---

## Features

- **Real-time analysis** — automatically triggers when you visit a news page
- **Sentence-level highlighting** — suspicious sentences are highlighted in yellow on the page
- **Detailed tooltips** — click any highlight to see the risk level, confidence score, and why it was flagged
- **Source cross-checking** — links to relevant articles from trusted outlets covering the same topic
- **Whitelist** — major trusted sources (Reuters, BBC, CNN, AP, NYT, etc.) are skipped automatically
- **Toggle on/off** — enable or disable monitoring from the extension popup at any time

---

## Architecture

```
Apollo/
├── backend/               # Python / Flask API
│   ├── server.py          # REST API + analysis pipeline
│   ├── models.py          # ML model loading (BERT, SBERT, spaCy)
│   ├── reliable_news_V2.py # Fact-checking via Google News (Serper API)
│   ├── config.yaml        # Thresholds, whitelist, regex patterns
│   └── patterns.yaml      # spaCy matcher patterns
└── frontend/              # Chrome Extension (Manifest v3)
    ├── manifest.json
    ├── background.js      # Service worker — orchestrates analysis
    ├── content.js         # Page injection — highlights + tooltips
    ├── popup.html/js      # Extension popup UI
    └── style(s).css
```

The extension captures the current tab URL, sends it to the local Flask backend, and displays the results by injecting highlights into the live DOM.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend framework | Flask + Flask-CORS |
| Fake news classification | Fine-tuned BERT (`transformers`) |
| Semantic similarity | Sentence Transformers (`all-mpnet-base-v2`) |
| NLP (NER, POS, parsing) | spaCy `en_core_web_trf` |
| Sentiment analysis | NLTK VADER |
| Article extraction | `newspaper3k` |
| Fact-checking search | Serper API (Google News) |
| Frontend | Vanilla JS, Chrome Extensions API (MV3) |

---

## Prerequisites

- Python 3.9+
- Google Chrome
- A fine-tuned BERT model for fake news classification (sequence classification format)

---

## How It Works

### Analysis Pipeline

1. **Article extraction** — `newspaper3k` fetches and parses the article text from the URL
2. **Whitelist check** — if the source is trusted, analysis is skipped and the article is marked safe
3. **Statement detection** — regex patterns and spaCy matchers identify sentences containing economic claims, political content, conspiracy language, or controversial statements
4. **Scoring** — each candidate sentence is scored using:
   - BERT classification confidence (fake vs. real)
   - NLTK VADER sentiment score (emotional manipulation signals)
   - Cosine similarity against a set of factual reference embeddings (SBERT)
5. **Sliding window** — BERT also analyzes the article in overlapping text windows for document-level context
6. **Fact-checking** — for flagged segments, the Serper API searches recent articles from 100+ trusted outlets to find corroborating or contradicting sources
7. **Result** — the API returns an overall prediction, a confidence score, and a list of suspicious segments with explanations

### Detection Signals

| Signal | Method |
|---|---|
| Conspiracy language | Regex (deep state, vaccines, 5G, …) |
| Economic misinformation | Regex + spaCy patterns |
| Political manipulation | Regex + NER |
| Emotional language | VADER sentiment score |
| Factual inconsistency | SBERT cosine similarity |
| Fake news classification | Fine-tuned BERT |

---

## Configuration

Key settings in `backend/config.yaml`:

```yaml
thresholds:
  detection: 0.8       # Minimum BERT confidence to flag as fake
  importance: 3        # Minimum importance score to surface a segment

models:
  bert_model: /path/to/your/finetuned_model
  sbert_model: all-mpnet-base-v2
  spacy_model: en_core_web_trf
```

The whitelist and regex patterns for each category (economic, political, controversy, conspiracy, source indicators) are also defined in `config.yaml`.

---

## Limitations

- The backend runs **locally** — the extension requires the Flask server to be active on your machine.
- Analysis quality depends on the fine-tuned BERT model used.
- Article extraction may fail on paywalled or JavaScript-heavy pages.
- The fact-checking search is limited to articles from the past 15 days.

---

## License

MIT
