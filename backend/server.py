from flask import Flask, request, jsonify
from flask_cors import CORS
from newspaper import Article
from nltk.tokenize import sent_tokenize
import re
from nltk.sentiment.vader import SentimentIntensityAnalyzer
from urllib.parse import urlparse
import logging
import torch


# Assuming models.py and reliable_news_V2.py are correctly set up
from models import bert_model, sbert_model, nlp, cosine_similarity, config, bert_tokenizer
from reliable_news_V2 import search_articles_by_query

# Configure logging
logging.basicConfig(
    level=logging.WARNING,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)



class StatementAnalyzer:
    def __init__(self):
        # Regular expressions for various indicators
        self.number_pattern = re.compile(config["regex"]["number_pattern"])
        self.economic_indicators = [re.compile(pattern) for pattern in config["regex"]["economic_indicators"]]
        self.political_entities = [re.compile(pattern) for pattern in config["regex"]["political_entities"]]
        self.controversy_indicators = [re.compile(pattern) for pattern in config["regex"]["controversy_indicators"]]
        self.source_indicators = [re.compile(pattern) for pattern in config["regex"]["source_indicators"]]
        self.conspiracy_indicators = [re.compile(pattern) for pattern in config["regex"]["conspiracy_indicators"]]
        self.sentiment_analyzer = SentimentIntensityAnalyzer()
        self.sbert_model = sbert_model

    def analyze_statement(self, sentence, doc=None, window_doc=None):
        # Analyze a single statement
        if doc is None:
            doc = nlp(sentence)
        analysis = {
            "types": set(),
            "named_entities": [],
            "has_numbers": False,
            "has_sources": False,
            "importance_score": 0,
            "sentiment_score": None,
            "similarity_score": None
        }
        sentiment_score = self.sentiment_analyzer.polarity_scores(sentence)
        analysis["sentiment_score"] = sentiment_score["compound"]

        if sentiment_score["compound"] < -0.5:
            analysis["types"].add("negative_sentiment")
            analysis["importance_score"] += 1
        elif sentiment_score["compound"] > 0.5:
            analysis["types"].add("positive_sentiment")

        if self.number_pattern.search(sentence):
            analysis["has_numbers"] = True

        # Functions to handle negations and specific expressions
        def check_negation(match, start_index=0):
            """
            Checks if a matched portion of a sentence is negated using spaCy's dependency parsing.

            Args:
                match (re.Match): The Match object resulting from a regular expression search.
                start_index (int): The starting index of the captured group within the Match object
                                (useful if you're capturing a specific group with parentheses
                                in your regex, defaults to 0 if capturing the entire match).

            Returns:
                bool: True if the matched portion is negated, False otherwise.
            """
            sentence = match.string  # Get the entire sentence from the match object
            doc = nlp(sentence)
            # Create a Span from the match, taking into account the start index
            span = doc.char_span(match.start(start_index), match.end(start_index))

            # Handle cases where char_span might not find an exact match
            if span is None:
                return False

            for token in span:
                for child in token.children:
                    if child.dep_ == "neg":
                        return True
            return False

        def check_specific_expression(match, expression_list, start_index=0):
            if match:
                for expression in expression_list:
                    if expression.lower() == match.group(0).lower():
                        return True
            return False

        # Using the context (window_doc) for the analysis of indicators
        if window_doc:
            # Economic indicators
            for pattern in self.economic_indicators:
                for match in pattern.finditer(window_doc.text.lower()):
                    if not check_negation(match) and not check_specific_expression(match, [
                        "increase", "decrease", "decline", "rise", "fall", "soar", "skyrocket", "plummet", "collapse",
                        "significant", "substantial", "massive", "major", "minor"]):
                        analysis["types"].add("economic")
                        analysis["importance_score"] += 1

            # Political entities
            for pattern in self.political_entities:
                for match in pattern.finditer(window_doc.text.lower()):
                    if not check_negation(match):
                        analysis["types"].add("political")
                        analysis["importance_score"] += 1

            # Controversy indicators
            for pattern in self.controversy_indicators:
                for match in pattern.finditer(window_doc.text.lower()):
                    if not check_negation(match) and not check_specific_expression(match, [
                        "violent", "heated", "intense", "mass", "large-scale", "alleged", "accused of",
                        "investigation into", "evidence of", "guilty of", "charged with"]):
                        analysis["types"].add("controversy")
                        analysis["importance_score"] += 2

            # Source indicators
            for pattern in self.source_indicators:
                for match in pattern.finditer(window_doc.text.lower()):
                    if check_negation(match) or check_specific_expression(match,
                                                                                ["according to", "reported by", "said",
                                                                                 "stated"]):
                        analysis["has_sources"] = True

            # Conspiracy indicators
            for pattern in self.conspiracy_indicators:
                for match in pattern.finditer(window_doc.text.lower()):
                    if not check_negation(match) and not check_specific_expression(match, [
                        "covid", "covid-19", "coronavirus", "vaccine", "vaccines", "vaccination"]):
                        analysis["types"].add("conspiracy")
                        analysis["importance_score"] += 3

            # Named entities from the context
            for ent in window_doc.ents:
                if ent.text not in [e["text"] for e in analysis["named_entities"]]:
                    analysis["named_entities"].append({
                        "text": ent.text,
                        "type": ent.label_
                    })

        # Similarity analysis (always performed)
        reference_sentence = "This statement is based on verifiable facts."
        analysis["similarity_score"] = self.compute_similarity(sentence, reference_sentence)

        if analysis["similarity_score"] < 0.6:
            analysis["types"].add("suspect_claim")
            analysis["importance_score"] += 1

        return analysis

    def compute_similarity(self, sentence1, sentence2):
        # Compute the similarity between two sentences using SBERT
        embeddings1 = self.sbert_model.encode([sentence1])
        embeddings2 = self.sbert_model.encode([sentence2])
        return cosine_similarity(embeddings1, embeddings2)

class ArticleAnalyzer:
    def __init__(self, threshold=0.9, importance_threshold=3):
        self.threshold = threshold
        self.importance_threshold = importance_threshold
        self.analyzer = StatementAnalyzer()
        self.threshold_high = 0.9
        self.threshold_low = 0.6

    def analyze_article(self, text, window_size=3):
        sentences = sent_tokenize(text)
        if not sentences:
            return {
                "overall_prediction": "Real News",
                "overall_confidence": 0.0,
                "suspicious_segments": [],
                "keywords": []
            }

        # Create sliding windows
        windows = [sentences[i:i + window_size] for i in range(len(sentences) - window_size + 1)]

        analyzed_segments = []
        current_position = 0


        docs = list(nlp.pipe(sentences))

        for window in windows:
            window_text = " ".join(window) 
            window_doc = nlp(window_text)  

       
            inputs = bert_tokenizer(window, padding=True, truncation=True, return_tensors="pt", max_length=512, is_split_into_words=True)

            with torch.no_grad():
                outputs = bert_model(**inputs)

            probs = torch.softmax(outputs.logits, dim=-1)
            predicted_probs = probs[:, 0].tolist()  

            predictions = torch.argmax(outputs.logits, dim=-1)
            labels = ["Fake News" if pred == 0 else "Real News" for pred in predictions]

           
            for i, (sentence, label, prob) in enumerate(zip(window, labels, predicted_probs)):
               
                sentence_doc = None
                for doc in docs:
                    if sentence == doc.text:
                        sentence_doc = doc
                        break

                # Analyze the sentence with the context of the window
                statement_analysis = self.analyzer.analyze_statement(sentence, doc=sentence_doc, window_doc=window_doc)

                # The segment is considered suspicious if labeled as "Fake News"
                if label == "Fake News":
                    analyzed_segments.append({
                        "text": sentence,
                        "start_position": current_position,
                        "end_position": current_position + len(sentence),
                        "confidence": prob,
                        "analysis": {
                            "statement_types": list(statement_analysis["types"]),
                            "named_entities": statement_analysis["named_entities"],
                            "has_numbers": statement_analysis["has_numbers"],
                            "has_sources": statement_analysis["has_sources"],
                            "context": window_text,
                            "importance_score": statement_analysis["importance_score"]  

                        }
                    })
                current_position += len(sentence) + 1  # +1 for space between sentences
        print(analyzed_segments)
        # Filter segments based on importance and calculate overall score
        filtered_segments = [s for s in analyzed_segments if s["analysis"]["importance_score"] >= self.importance_threshold]
        overall_prediction, suspicious_score = self._calculate_overall_score(filtered_segments)

        return {
            "overall_prediction": overall_prediction,
            "overall_confidence": suspicious_score,
            "suspicious_segments": filtered_segments,
        }

    def _calculate_overall_score(self, segments):
        # Calculate the overall score of the article based on suspicious segments
        total_important_statements = len(segments)

        adjusted_threshold_high = self.threshold_high - (0.05 * (total_important_statements / 10))
        adjusted_threshold_low = self.threshold_low + (0.05 * (total_important_statements / 10))

        if total_important_statements == 0:
            return "Real News", 0.0

        weighted_sum = 0
        total_length = 0

        for segment in segments:
            weighted_sum += segment["confidence"] * len(segment["text"])
            total_length += len(segment["text"])

        if total_length == 0:
            return "Real News", 0.0

        suspicious_score = weighted_sum / total_length if total_important_statements > 0 else 0

        if suspicious_score >= adjusted_threshold_high:
            overall_prediction = "Fake News"
        elif suspicious_score < adjusted_threshold_low:
            overall_prediction = "Real News"
        else:
            overall_prediction = "Uncertain"

        return overall_prediction, suspicious_score

def extract_text_from_url(url):
    # Extract the title and text from the given URL
    try:
        article = Article(url)
        article.download()
        article.parse()
        return {"title": article.title, "text": article.text}
    except Exception as e:
        raise Exception(f"Error extracting text: {str(e)}")

@app.route('/execute', methods=['POST'])
def execute_script():
    # Main function to process the URL and analyze the article
    try:
        logger.info("Processing new request")
        data = request.get_json()
        url = data.get('url')
        if not url:
            logger.warning("Request received without URL")
            return jsonify({"status": "error", "message": "URL is required"}), 400

        article_data = extract_text_from_url(url)
        analyzer = ArticleAnalyzer(threshold=config["threshold"], importance_threshold=config["importance_threshold"])

        # Extract the domain name from the URL
        parsed_url = urlparse(url)
        domain = parsed_url.netloc

        # Check the source against the whitelist
        if domain in config["whitelist"]["sources"]:
            logger.info(f"Source {domain} is in whitelist. Skipping analysis.")
            analysis_results = {
                "overall_prediction": "Real News",
                "overall_confidence": 1.0, # Maximum confidence for trusted sources
                "suspicious_segments": []
            }
        else:
            logger.info(f"Source {domain} is not in whitelist. Analyzing article content")
            analysis_results = analyzer.analyze_article(article_data["text"])

        # Find reliable articles for each suspicious segment
        for segment in analysis_results["suspicious_segments"]:
            reliable_articles = search_articles_by_query(segment["text"], top_n=1)
            segment["reliable_articles"] = reliable_articles

        return jsonify({
            "status": "success",
            "title": article_data["title"],
            "overall_prediction": analysis_results["overall_prediction"],
            "overall_confidence": f"{analysis_results['overall_confidence']:.2%}",
            "suspicious_segments": analysis_results["suspicious_segments"]
        }), 200

    except Exception as e:
        logger.error(f"Error processing request: {e}", exc_info=True)
        return jsonify({"status": "error", "message": f"Failed to process URL: {str(e)}"}), 500

if __name__ == '__main__':
    app.logger.setLevel(logging.ERROR)
    app.run(debug=False, host='127.0.0.1', port=5000)