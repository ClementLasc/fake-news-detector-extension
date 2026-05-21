import os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
import logging
import warnings
from transformers import logging as transformers_logging, AutoModelForSequenceClassification, AutoTokenizer
import nltk
import spacy
from sentence_transformers import SentenceTransformer
import yaml
import numpy as np

# Configuration des logs
logging.basicConfig(
    level=logging.WARNING,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)
warnings.filterwarnings('ignore', category=UserWarning, module='pandas')
transformers_logging.set_verbosity_error()
# Disable NLTK warnings
warnings.filterwarnings('ignore')

# Chargement de la configuration
with open('config.yaml', 'r') as f:
    config = yaml.safe_load(f)

# Téléchargement des ressources NLTK
try:
    for ressource in config["nltk_ressources"]:
        nltk.download(ressource, quiet=True)
except Exception as e:
    logger.error(f"Error loading NLTK resources: {e}")

def cosine_similarity(v1, v2):
    return np.dot(v1, v2.T) / (np.linalg.norm(v1) * np.linalg.norm(v2))


model_path = config["bert_model"] 
bert_model = AutoModelForSequenceClassification.from_pretrained(model_path)
bert_tokenizer = AutoTokenizer.from_pretrained(model_path)

# Modèle Sentence Transformer
sbert_model = SentenceTransformer(config["sbert_model"])

# Modèle spaCy
try:
    nlp = spacy.load(config["spacy_model"])
except OSError:
    print("Downloading language model for the spaCy POS tagger (don't worry, this will only happen once)")
    from spacy.cli import download
    download(config["spacy_model"])
    nlp = spacy.load(config["spacy_model"])

print("All models loaded successfully.")
