"""KARMA baseline experience — the autonomous seed corpus.

On first boot with an empty database, KARMA ingests everything below into its
RAG memory. Replace these entries with your real details, or paste your resume
through the dashboard's Ingest tab (parsed + merged automatically).
"""

SEED_PROFILE = {
    "name": "Your Name",
    "headline": "AIML + Python backend developer (FastAPI / RAG)",
    "summary": (
        "AIML + Python developer focused on retrieval-augmented intelligent systems. "
        "Works with FastAPI, Qdrant, Redis, scikit-learn and LLM APIs (GPT-4o, Gemini), "
        "and has built projects spanning machine learning models, REST APIs and "
        "autonomous agents. Enjoys systems that continuously improve themselves."
    ),
    "email": "you@example.com",
    "location": "",
    "links": {"github": "", "linkedin": "", "portfolio": ""},
}

SEED_EXPERIENCES = [
    {
        "title": "Machine Learning Foundations",
        "organization": "Self-directed learning + labs",
        "kind": "education",
        "description": (
            "Studied core machine learning: regression, classification, clustering, "
            "model evaluation, feature engineering and overfitting controls. Practised "
            "in Python with NumPy, pandas and scikit-learn through notebook labs."
        ),
        "skills": [
            "Python", "NumPy", "pandas", "scikit-learn",
            "model evaluation", "feature engineering",
        ],
        "highlights": [
            "Trained and evaluated classifiers on tabular datasets with accuracy, precision, recall and F1 reporting.",
            "Practised train/validation/test discipline and cross-validation to control overfitting.",
        ],
    },
    {
        "title": "RAG and intelligent-systems engineering",
        "organization": "KARMA project",
        "kind": "project",
        "description": (
            "Built a from-scratch retrieval-augmented generation engine in Python: "
            "structural chunking, hybrid BM25 + TF-IDF (scikit-learn) retrieval with "
            "reciprocal rank fusion, Qdrant vector search, GPT-4o/Gemini reranking and "
            "grounded cited answer synthesis for this autonomous career-intelligence platform."
        ),
        "skills": [
            "RAG", "embeddings", "TF-IDF", "BM25", "reranking", "chunking",
            "information retrieval", "Qdrant", "scikit-learn",
        ],
        "highlights": [
            "Implemented hybrid BM25 + TF-IDF retrieval with weighted reciprocal rank fusion over a Qdrant-backed vector store.",
            "Designed overlap-preserving structural chunking with a no-text-loss remainder guarantee.",
            "Added GPT-4o and Gemini reranking plus grounded cited synthesis with automatic local fallback.",
        ],
    },
    {
        "title": "FastAPI backend and autonomous-agent platform",
        "organization": "KARMA project",
        "kind": "project",
        "description": (
            "Built the KARMA backend with Python, FastAPI and Motor (MongoDB): REST API "
            "serving, an APScheduler cron-driven autonomous agent that self-evaluates "
            "retrieval quality, Redis answer caching, Pandas/NumPy retrieval evaluation, "
            "and Docker Compose deployment for the full stack."
        ),
        "skills": [
            "Python", "FastAPI", "MongoDB", "Motor", "APScheduler", "Redis",
            "Docker", "REST API", "testing",
        ],
        "highlights": [
            "Designed an APScheduler cron-driven DDA agent (discover, digest, augment) that writes reports and enriches its own index idempotently.",
            "Added Redis-backed answer caching with corpus-version invalidation and a zero-dependency in-process fallback.",
            "Containerized the full stack (FastAPI, Qdrant, Redis, MongoDB) with Docker Compose.",
        ],
    },
    {
        "title": "Software engineering workflows",
        "organization": "Personal projects",
        "kind": "personal",
        "description": (
            "Regular practice with Git, code review discipline, testing (pytest unit + "
            "integration), debugging in Python and browser environments, and writing "
            "clear project documentation."
        ),
        "skills": ["Git", "GitHub", "testing", "pytest", "debugging", "documentation"],
        "highlights": [
            "Wrote unit and integration test suites covering API flows end to end.",
            "Documented architecture decisions in project READMEs.",
        ],
    },
]
