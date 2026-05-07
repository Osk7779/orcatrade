const fs = require('fs');
const path = require('path');

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'should', 'could', 'may', 'might', 'must', 'shall', 'to', 'of',
  'in', 'on', 'at', 'by', 'for', 'with', 'about', 'against', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'from', 'up', 'down', 'out',
  'off', 'over', 'under', 'again', 'further', 'then', 'once', 'this', 'that',
  'these', 'those', 'as', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it',
  'its', 'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'whose',
  'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'can', 'just', 'also',
]);

const TOKEN_PATTERN = /[a-z0-9]+/g;

function tokenize(text) {
  if (!text) return [];
  const lowered = String(text).toLowerCase();
  const matches = lowered.match(TOKEN_PATTERN) || [];
  return matches.filter(token => token.length > 1 && !STOPWORDS.has(token));
}

function buildIndex(chunks) {
  const docs = chunks.map(chunk => {
    const fullText = [chunk.article, chunk.title, chunk.summary, chunk.verbatim, (chunk.topics || []).join(' ')]
      .filter(Boolean)
      .join(' ');
    const tokens = tokenize(fullText);
    const termFreq = new Map();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }
    return { chunk, tokens, termFreq, length: tokens.length };
  });

  const docFreq = new Map();
  for (const doc of docs) {
    for (const term of doc.termFreq.keys()) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  const totalDocs = docs.length;
  const avgLength = totalDocs === 0 ? 0 : docs.reduce((sum, doc) => sum + doc.length, 0) / totalDocs;

  return { docs, docFreq, totalDocs, avgLength };
}

function bm25Score(queryTokens, doc, index, k1 = 1.2, b = 0.75) {
  let score = 0;
  for (const term of queryTokens) {
    const tf = doc.termFreq.get(term) || 0;
    if (tf === 0) continue;
    const df = index.docFreq.get(term) || 0;
    const idf = Math.log(((index.totalDocs - df + 0.5) / (df + 0.5)) + 1);
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (doc.length / (index.avgLength || 1)));
    score += idf * (numerator / denominator);
  }
  return score;
}

function topicBoost(queryTokens, chunk) {
  const topics = chunk.topics || [];
  if (!topics.length) return 0;
  const querySet = new Set(queryTokens);
  let hits = 0;
  for (const topic of topics) {
    const topicTokens = topic.split(/[-_\s]+/);
    for (const token of topicTokens) {
      if (querySet.has(token.toLowerCase())) {
        hits += 1;
        break;
      }
    }
  }
  return hits * 0.5;
}

let cachedCorpora = null;

function loadCorpora() {
  if (cachedCorpora) return cachedCorpora;
  const corpusDir = path.join(__dirname, 'corpus');
  if (!fs.existsSync(corpusDir)) {
    cachedCorpora = {};
    return cachedCorpora;
  }
  const files = fs.readdirSync(corpusDir).filter(name => name.endsWith('.json'));
  const corpora = {};
  for (const file of files) {
    const fullPath = path.join(corpusDir, file);
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      const parsed = JSON.parse(raw);
      const id = parsed.regulation && parsed.regulation.id ? parsed.regulation.id : path.basename(file, '.json');
      corpora[id] = {
        regulation: parsed.regulation || { id, shortName: id.toUpperCase() },
        chunks: parsed.chunks || [],
        index: buildIndex(parsed.chunks || []),
      };
    } catch (error) {
      console.error(`Failed to load corpus ${file}:`, error.message);
    }
  }
  cachedCorpora = corpora;
  return cachedCorpora;
}

function listRegulations() {
  const corpora = loadCorpora();
  return Object.values(corpora).map(corpus => corpus.regulation);
}

function getRegulation(regulationId) {
  const corpora = loadCorpora();
  const corpus = corpora[regulationId];
  if (!corpus) return null;
  return corpus.regulation;
}

function getChunkById(chunkId) {
  const corpora = loadCorpora();
  for (const corpus of Object.values(corpora)) {
    const found = corpus.chunks.find(chunk => chunk.id === chunkId);
    if (found) return { ...found, regulationId: corpus.regulation.id, regulation: corpus.regulation };
  }
  return null;
}

function search(query, options = {}) {
  const { regulationIds = null, topK = 5, minScore = 0.1 } = options;
  const corpora = loadCorpora();
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];

  const candidates = [];
  for (const corpus of Object.values(corpora)) {
    if (regulationIds && !regulationIds.includes(corpus.regulation.id)) continue;
    for (const doc of corpus.index.docs) {
      const score = bm25Score(queryTokens, doc, corpus.index) + topicBoost(queryTokens, doc.chunk);
      if (score < minScore) continue;
      candidates.push({
        regulationId: corpus.regulation.id,
        regulation: corpus.regulation,
        chunk: doc.chunk,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, topK);
}

function resetCache() {
  cachedCorpora = null;
}

module.exports = {
  tokenize,
  buildIndex,
  search,
  loadCorpora,
  listRegulations,
  getRegulation,
  getChunkById,
  resetCache,
};
