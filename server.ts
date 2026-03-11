import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import { GoogleGenAI, Type } from '@google/genai';
import Stripe from 'stripe';
import Parser from 'rss-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const db = new Database('news.db');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT,
    image_url TEXT,
    location_name TEXT,
    lat REAL,
    lng REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    tier TEXT DEFAULT 'free',
    interests TEXT DEFAULT '[]',
    language TEXT DEFAULT 'en',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS user_views (
    user_id INTEGER,
    post_id INTEGER,
    viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, post_id)
  );
`);

// Migrations for existing posts table
try { db.exec("ALTER TABLE posts ADD COLUMN is_premium INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE posts ADD COLUMN tags TEXT DEFAULT '[]'"); } catch (e) {}
try { db.exec("ALTER TABLE posts ADD COLUMN source_url TEXT"); } catch (e) {}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', { apiVersion: '2023-10-16' as any });
const parser = new Parser();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

const RSS_FEEDS = [
  'https://techcrunch.com/category/artificial-intelligence/feed/',
  'http://export.arxiv.org/rss/cs.AI',
  'https://news.mit.edu/rss/topic/artificial-intelligence2'
];

async function generateNews() {
  console.log('Generating new AI news from RSS feeds...');
  try {
    let aggregatedItems: any[] = [];
    for (const url of RSS_FEEDS) {
      try {
        const feed = await parser.parseURL(url);
        aggregatedItems.push(...feed.items.slice(0, 3).map(i => ({ title: i.title, snippet: i.contentSnippet, link: i.link })));
      } catch (e) {
        console.error('Failed to parse feed:', url, e);
      }
    }

    const feedContext = JSON.stringify(aggregatedItems);

    const searchResponse = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: `Analyze these recent AI news items from top sources: ${feedContext}. 
      Select the most impactful story or synthesize a trend. 
      Write a detailed, engaging blog post script. 
      Determine if this should be a 'premium' in-depth analysis report (true/false).
      Also provide relevant tags, a location query (city/headquarters), and an image prompt.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            content: { type: Type.STRING, description: 'Detailed blog post script in Markdown.' },
            isPremium: { type: Type.BOOLEAN, description: 'True if this is an in-depth, exclusive analysis report.' },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            locationQuery: { type: Type.STRING, description: 'City or location relevant to this news' },
            imagePrompt: { type: Type.STRING, description: 'Prompt for a minimalistic image representing this news. No text.' },
            sourceUrl: { type: Type.STRING, description: 'Primary source URL if applicable' }
          },
          required: ['title', 'content', 'isPremium', 'tags', 'locationQuery', 'imagePrompt']
        }
      }
    });

    const newsData = JSON.parse(searchResponse.text || '{}');
    if (!newsData.title) throw new Error('Failed to generate news content');

    let imageUrl = '';
    try {
      const imageResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: newsData.imagePrompt + ' minimalistic, clean, modern, vector art style, no text',
      });
      for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          break;
        }
      }
    } catch (e) {
      console.error('Image generation failed', e);
    }

    let lat = 0, lng = 0, locationName = newsData.locationQuery;
    try {
      const mapsResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Find the coordinates for: ${newsData.locationQuery}. Return ONLY a JSON object with lat and lng properties.`,
        config: {
          tools: [{ googleMaps: {} }],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              lat: { type: Type.NUMBER },
              lng: { type: Type.NUMBER }
            },
            required: ['lat', 'lng']
          }
        }
      });
      const coords = JSON.parse(mapsResponse.text || '{}');
      lat = coords.lat || 0;
      lng = coords.lng || 0;
    } catch (e) {
      console.error('Maps failed', e);
    }

    const stmt = db.prepare('INSERT INTO posts (title, content, image_url, location_name, lat, lng, is_premium, tags, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    stmt.run(newsData.title, newsData.content, imageUrl, locationName, lat, lng, newsData.isPremium ? 1 : 0, JSON.stringify(newsData.tags || []), newsData.sourceUrl || '');
    console.log('Successfully generated and saved news:', newsData.title);
  } catch (error) {
    console.error('Error in generateNews:', error);
  }
}

function checkAndGenerateNews() {
  try {
    const stmt = db.prepare("SELECT count(*) as count FROM posts WHERE date(created_at) = date('now')");
    const row = stmt.get() as { count: number };
    if (row.count === 0) {
      generateNews();
    }
  } catch (error) {
    console.error('Error checking news:', error);
  }
}

// Auth Middleware
const authenticate = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
    } catch (e) {}
  }
  next();
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(authenticate);

  // Auth Routes
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, interests, language } = req.body;
      const hashedPassword = await bcrypt.hash(password, 10);
      const stmt = db.prepare('INSERT INTO users (email, password, interests, language) VALUES (?, ?, ?, ?)');
      const info = stmt.run(email, hashedPassword, JSON.stringify(interests || []), language || 'en');
      const token = jwt.sign({ id: info.lastInsertRowid }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, user: { id: info.lastInsertRowid, email, tier: 'free', interests, language } });
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') res.status(400).json({ error: 'Email already exists' });
      else res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      const user: any = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
      const { password: _, ...userWithoutPassword } = user;
      userWithoutPassword.interests = JSON.parse(userWithoutPassword.interests || '[]');
      res.json({ token, user: userWithoutPassword });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/auth/me', (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { password: _, ...userWithoutPassword } = req.user;
    userWithoutPassword.interests = JSON.parse(userWithoutPassword.interests || '[]');
    res.json({ user: userWithoutPassword });
  });

  // Stripe Checkout
  app.post('/api/stripe/checkout', async (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { tier } = req.body; // 'basic' or 'premium'
    
    // In a real app, you'd create a Stripe Checkout Session here.
    // For this prototype, we'll mock the upgrade directly.
    try {
      db.prepare('UPDATE users SET tier = ? WHERE id = ?').run(tier, req.user.id);
      res.json({ success: true, message: `Upgraded to ${tier} tier successfully (Mocked)` });
    } catch (error) {
      res.status(500).json({ error: 'Failed to upgrade' });
    }
  });

  // Posts Route with Personalization
  app.get('/api/posts', async (req: any, res) => {
    try {
      const user = req.user;
      const lang = user?.language || req.query.lang as string || 'en';
      const interests = user ? JSON.parse(user.interests || '[]') : [];
      const tier = user?.tier || 'free';
      
      const stmt = db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 10');
      const posts = stmt.all() as any[];

      // Personalization Engine
      const personalizedPosts = await Promise.all(posts.map(async (post) => {
        // Hide premium content for free users
        if (post.is_premium && tier === 'free') {
          return { ...post, content: 'This is an exclusive in-depth analysis report. Please upgrade to Premium to read the full article.', locked: true };
        }

        // If user has specific interests or different language, tailor the content
        if (lang !== 'en' || interests.length > 0) {
          try {
            const prompt = `Rewrite the following AI news article to match the user's preferences.
            User Language: ${lang}
            User Interests: ${interests.join(', ')}
            User Tier: ${tier} (If premium, provide more depth and technical details. If basic/free, keep it accessible).
            
            Original Title: ${post.title}
            Original Content: ${post.content}
            
            Return ONLY a JSON object with 'title' and 'content' (Markdown).`;

            const translationResponse = await ai.models.generateContent({
              model: 'gemini-3.1-flash-lite-preview',
              contents: prompt,
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    content: { type: Type.STRING }
                  },
                  required: ['title', 'content']
                }
              }
            });
            const tailored = JSON.parse(translationResponse.text || '{}');
            return { ...post, title: tailored.title || post.title, content: tailored.content || post.content };
          } catch (e) {
            console.error('Tailoring failed for post', post.id, e);
            return post;
          }
        }
        return post;
      }));

      // Sort by relevance to interests (simple mock sorting: premium first if premium user)
      if (tier === 'premium') {
        personalizedPosts.sort((a, b) => (b.is_premium ? 1 : 0) - (a.is_premium ? 1 : 0));
      }

      res.json(personalizedPosts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/posts/:id/view', (req: any, res) => {
    if (req.user) {
      try {
        db.prepare('INSERT OR IGNORE INTO user_views (user_id, post_id) VALUES (?, ?)').run(req.user.id, req.params.id);
      } catch (e) {}
    }
    res.json({ success: true });
  });

  app.post('/api/subscribe', (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email is required' });
      const stmt = db.prepare('INSERT INTO subscribers (email) VALUES (?)');
      stmt.run(email);
      res.json({ success: true });
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') res.status(400).json({ error: 'Email already subscribed' });
      else res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/admin/generate', async (req, res) => {
    generateNews();
    res.json({ success: true, message: 'Generation started' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    checkAndGenerateNews();
    setInterval(checkAndGenerateNews, 1000 * 60 * 60 * 4);
  });
}

startServer();
