from urllib.parse import urlparse
from sentence_transformers import  util
import requests
from datetime import datetime, timedelta
import json
from bs4 import BeautifulSoup
from models import nlp,sbert_model


# Clé API Serper (à remplacer par ta clé)
SERPER_API_KEY = "971395e6d311a689057b85f5ab639d990ed1fa12"

# Liste de sources fiables (peut être utilisée pour filtrer les résultats plus tard, si nécessaire)
reliable_sources = [
    # Major US Newspapers
    "nytimes.com", 
    "washingtonpost.com", 
    "latimes.com", 
    "wsj.com", 
    "usatoday.com",

    # International Newspapers
    "theguardian.com", 
    "independent.co.uk", 
    "theglobeandmail.com", 

    # US News Sites
    "politico.com", 
    "thehill.com", 
    "cnn.com", 
    "abcnews.go.com", 
    "cbsnews.com", 
    "nbcnews.com",

    # International News Sites
    "bbc.co.uk", 
    "skynews.com", 
    "france24.com", 
    "dw.com", 
    "euronews.com", 
    "tagesschau.de", 
    "ndtv.com", 
    "lastampa.it", 
    "abc.es",
    "lavanguardia.com", 
    "tagesanzeiger.ch", 
    "swissinfo.ch", 
    "estadao.com.br", 
    "oglobo.globo.com",

    # Magazines
    "theatlantic.com", 
    "newyorker.com", 
    "time.com", 
    "theeconomist.com", 
    "foreignaffairs.com",
    "foreignpolicy.com", 
    "csmonitor.com",

    # Business and Finance
    "cnbc.com", 
    "bloomberg.com", 
    "forbes.com", 
    "inc.com", 
    "fastcompany.com", 
    "businessinsider.com", 
    "hbr.org", 
    "money.cnn.com", 
    "ft.com", 

    # Science and Technology
    "nasa.gov", 
    "nature.com", 
    "science.org", 
    "scientificamerican.com", 
    "newscientist.com", 
    "techcrunch.com",
    "wired.com", 
    "arstechnica.com", 
    "theverge.com", 
    "technologyreview.com", 
    "popsci.com", 
    "popmech.com", 
    "space.com", 
    "universetoday.com", 
    "sciencealert.com", 
    "discovermagazine.com",
    "quantamagazine.org", 
    "livescience.com", 
    "cnet.com", 
    "engadget.com", 
    "gizmodo.com", 
    "zdnet.com",

    # Health and Medicine
    "who.int", 
    "cdc.gov", 
    "nih.gov", 
    "webmd.com", 
    "mayoclinic.org", 
    "health.harvard.edu", 
    "hopkinsmedicine.org",

    # Environment and Climate
    "climate.nasa.gov", 
    "noaa.gov", 
    "nationalgeographic.com", 
    "unep.org", 
    "edf.org", 
    "worldwildlife.org", 
    "climatecentral.org",
    "insideclimatenews.org", 
    "grist.org", 
    "yaleclimateconnections.org",

    # News Agencies
    "reuters.com", 
    "ap.org", 
    "afp.com", 
    "apnews.com",

    # Organizations
    "un.org", 
    "worldbank.org", 
    "imf.org" 
]
def calculate_similarity(text1, text2):
    """
    Calcule la similarité cosinus entre deux textes à l'aide de Sentence Transformers.
    """
    if not text1 or not text2:
        print("Erreur: L'un des textes est vide.")
        return 0.0
    try:
        embedding1 = sbert_model.encode(text1, convert_to_tensor=True)
        embedding2 = sbert_model.encode(text2, convert_to_tensor=True)
        similarity = util.pytorch_cos_sim(embedding1, embedding2).item()
        return similarity
    except Exception as e:
        print(f"Erreur lors du calcul de similarité : {e}")
        return 0.0

def extract_keywords(query):
    """
    Extrait les mots-clés d'une requête en combinant POS tagging et entités nommées.
    """
    doc = nlp(query)
    keywords = []
    temp_keywords = set()

    for token in doc:
        if token.pos_ in ("NOUN", "PROPN", "VERB", "ADJ"):
            temp_keywords.add(token.lemma_)

    for ent in doc.ents:
        keywords.append(ent.text)

    for keyword in temp_keywords:
        if not any(ent.text == keyword for ent in doc.ents):
            keywords.append(keyword)

    return keywords

def filter_keywords_by_similarity(keywords, query, threshold=0.35):
    doc = nlp(query)
    ents = {ent.text.lower() for ent in doc.ents}

    filtered_keywords = []
    similarities = {}

    for keyword in keywords:
        keyword_lower = keyword.lower()
        if keyword_lower in ents:
            filtered_keywords.append(keyword)
        else:
            similarity = calculate_similarity(keyword_lower, query.lower())
            if similarity >= threshold:
                similarities[keyword] = similarity

    sorted_keywords = sorted(similarities.items(), key=lambda item: item[1], reverse=True)
    filtered_keywords.extend([keyword for keyword, score in sorted_keywords[:5]])

    return filtered_keywords

def build_serper_query(keywords, date_limit=None):
    """
    Construit la requête pour l'API Serper à partir de mots-clés.
    """
    query = " OR ".join([f'"{kw}"' if " " in kw else kw for kw in keywords])
    if date_limit:
        formatted_date = date_limit.strftime("%Y-%m-%d")
        query += f" after:{formatted_date}"
    return query

def get_serper_results(query, max_news=20):
    """
    Récupère les résultats de recherche via l'API Serper.
    """
    url = "https://google.serper.dev/news"

    payload = json.dumps({
        "q": query,
        "num": max_news
    })
    headers = {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json'
    }

    response = requests.request("POST", url, headers=headers, data=payload)

    response.raise_for_status()  # Gérer les erreurs HTTP

    return response.json()

def filter_articles_by_similarity(query, serper_results, similarity_threshold=0.4):
    """
    Filtre les articles de Serper en fonction de la similarité de leur titre avec la requête,
    trie les articles par similarité décroissante et prend en compte les sources fiables.
    """
    similar_articles = []
    for result in serper_results.get("news", []):
        title = result.get("title")
        link = result.get("link")
        source = result.get("source")

        if title and link:
            similarity = calculate_similarity(query, title)
            if similarity >= similarity_threshold:
                similar_articles.append({
                    "title": title,
                    "url": link,
                    "source": source,
                    "similarity": similarity
                })

    # Trier les articles par similarité décroissante
    similar_articles.sort(key=lambda x: x["similarity"], reverse=True)
    return similar_articles

def extract_content(url):
    """
    Extrait le titre et le contenu d'un article à partir d'une URL.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, "html.parser")

        title = soup.find("title").text if soup.find("title") else ""

        for script_or_style in soup(["script", "style"]):
            script_or_style.decompose()
        text = soup.get_text(separator=" ", strip=True)

        return {"title": title, "content": text, "url": url}
    except Exception as e:
        print(f"Erreur lors de l'extraction du contenu de {url} : {e}")
        return None

def search_articles_by_query(query, days_back=15, top_n=3):
    """
    Recherche des articles similaires à une requête en utilisant Serper,
    en générant une requête étendue à partir de mots-clés extraits.
    """
    print(f"Query: {query}")

    # Extraction et filtrage des mots-clés
    keywords = extract_keywords(query)
    print(f"Keywords extracted: {keywords}")

    filtered_keywords = filter_keywords_by_similarity(keywords, query)
    print(f"Keywords after similarity filtering: {filtered_keywords}")

    # Limiter le nombre de mots-clés
    max_keywords = 5
    filtered_keywords = filtered_keywords[:max_keywords]

    # Construction de la requête Serper
    date_limit = datetime.now() - timedelta(days=days_back)
    serper_query = build_serper_query(filtered_keywords, date_limit)
    serper_results = get_serper_results(serper_query)
    similar_articles = filter_articles_by_similarity(query, serper_results)
    
    
    similar_articles_url = []
    for article in similar_articles:
        parsed_url = urlparse(article["url"])
        
        domain = parsed_url.netloc
        if domain.startswith("www."):  # Supprimer le "www." s'il est présent
            domain = domain[4:]
        if domain in reliable_sources:
            similar_articles_url.append(article["url"])
    
    print(similar_articles_url)   
    return similar_articles_url[:top_n]

