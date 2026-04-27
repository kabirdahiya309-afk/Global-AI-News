import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import { GoogleGenAI, Type } from '@google/genai';
import Stripe from 'stripe';
import Parser from 'rss-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

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
try { db.exec("ALTER TABLE posts ADD COLUMN trailer_path TEXT"); } catch (e) {}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', { apiVersion: '2023-10-16' as any });
const parser = new Parser();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

// ── HyperFrames Trailer ────────────────────────────────────────────────────

interface TrailerContent {
  opening_line: string;
  headline: string;
  line1: string;
  line2: string;
  line3: string;
  impact: string;
  cta: string;
}

const PREVIEW_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>HyperFrames Preview</title>
    <style>html,body{margin:0;padding:0;background:#111;height:100%;overflow:hidden;}</style>
    <script type="module" src="https://cdn.jsdelivr.net/npm/@hyperframes/player"></script>
  </head>
  <body>
    <hyperframes-player id="p" controls autoplay muted style="display:block;width:100vw;height:100vh"></hyperframes-player>
    <script>document.getElementById("p").setAttribute("src", "./index.html" + location.search);</script>
  </body>
</html>`;

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildTrailerHTML(content: TrailerContent): string {
  const words = content.headline.split(/\s+/).slice(0, 10);
  const wordSpans = words
    .map((w, i) => `<span id="s2-w${i}" style="display:inline-block;margin:0 6px;">${escHtml(w.toUpperCase())}</span>`)
    .join('');
  const wordAnimations = words
    .map((_, i) => `tl.from("#s2-w${i}", { y: 60, autoAlpha: 0, duration: 0.45, ease: "expo.out" }, ${(3.15 + i * 0.18).toFixed(2)});`)
    .join('\n      ');
  const ruleStart = (3.15 + words.length * 0.18 + 0.25).toFixed(2);

  const ol = escHtml(content.opening_line.toUpperCase());
  const l1 = escHtml(content.line1.toUpperCase());
  const l2 = escHtml(content.line2.toUpperCase());
  const l3 = escHtml(content.line3.toUpperCase());
  const impact = escHtml(content.impact.toUpperCase());
  const cta = escHtml(content.cta);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Trailer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Oswald:wght@300;400;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/runtime"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:1920px;height:1080px;overflow:hidden;background:#000}
    :root{--bg:#080808;--text:#ffffff;--accent:#cc1a1a;--gold:#c9a227;--f-title:'Cinzel',serif;--f-body:'Oswald',sans-serif}
    .scene{position:absolute;width:1920px;height:1080px;background:var(--bg);display:flex;align-items:center;justify-content:center}
    .clip{overflow:hidden}
    .scene-content{position:relative;z-index:10;text-align:center;width:100%;padding:0 160px}
    .vignette{position:absolute;inset:0;pointer-events:none;z-index:40;background:radial-gradient(ellipse at center,transparent 40%,rgba(0,0,0,0.75) 100%)}
    .grain{position:absolute;inset:0;pointer-events:none;z-index:50;opacity:0.1;background-image:radial-gradient(rgba(255,255,255,0.06) 1px,transparent 1.2px),radial-gradient(rgba(0,0,0,0.15) 1px,transparent 1.2px);background-size:3px 3px,5px 5px;background-position:0 0,1px 2px;mix-blend-mode:overlay}
    .bar{position:absolute;left:0;right:0;height:90px;background:#000;z-index:60}
    .bar-t{top:0}.bar-b{bottom:0}
  </style>
</head>
<body data-composition-id="main">
  <div class="bar bar-t"></div>
  <div class="bar bar-b"></div>

  <!-- S1: PRESENTS (anchor, 0–3s) -->
  <div id="s1" class="scene clip" data-composition-id="main" data-start="0" data-duration="3" style="opacity:0;">
    <div class="vignette"></div><div class="grain"></div>
    <div class="scene-content">
      <div id="s1-brand" style="font-family:var(--f-body);font-weight:300;font-size:26px;letter-spacing:0.5em;color:rgba(255,255,255,0.45);text-transform:uppercase;">GLOBAL AI NEWS</div>
      <div id="s1-presents" style="font-family:var(--f-body);font-weight:300;font-size:20px;letter-spacing:0.7em;color:rgba(255,255,255,0.25);text-transform:uppercase;margin-top:14px;">PRESENTS</div>
      <div id="s1-ol" style="font-family:var(--f-body);font-weight:400;font-size:30px;letter-spacing:0.15em;color:rgba(255,255,255,0.6);text-transform:uppercase;margin-top:28px;">${ol}</div>
      <div id="s1-rule" style="height:1px;background:var(--accent);margin:20px auto 0;width:0;max-width:300px;"></div>
    </div>
  </div>

  <!-- S2: HEADLINE (non-anchor, 3–7.5s) -->
  <div id="s2" class="scene clip" data-composition-id="main" data-start="3" data-duration="4.5" style="visibility:hidden;">
    <div class="vignette"></div><div class="grain"></div>
    <div class="scene-content">
      <div id="s2-headline" style="font-family:var(--f-title);font-weight:700;font-size:88px;color:var(--text);line-height:1.15;text-transform:uppercase;letter-spacing:0.02em;">${wordSpans}</div>
      <div id="s2-rule" style="height:3px;background:var(--accent);margin:28px auto 0;width:0;max-width:220px;"></div>
    </div>
  </div>

  <!-- S3: LINE 1 (anchor, 7.5–11s) -->
  <div id="s3" class="scene clip" data-composition-id="main" data-start="7.5" data-duration="3.5" style="opacity:0;">
    <div class="vignette"></div><div class="grain"></div>
    <div class="scene-content">
      <div id="s3-text" style="font-family:var(--f-body);font-weight:700;font-size:78px;color:var(--text);text-transform:uppercase;letter-spacing:0.04em;line-height:1.15;">${l1}</div>
    </div>
  </div>

  <!-- S4: LINE 2 (non-anchor, 11–14.5s) -->
  <div id="s4" class="scene clip" data-composition-id="main" data-start="11" data-duration="3.5" style="visibility:hidden;">
    <div class="vignette"></div><div class="grain"></div>
    <div class="scene-content">
      <div id="s4-text" style="font-family:var(--f-body);font-weight:700;font-size:78px;color:var(--accent);text-transform:uppercase;letter-spacing:0.04em;line-height:1.15;">${l2}</div>
    </div>
  </div>

  <!-- S5: LINE 3 (non-anchor, 14.5–18s) -->
  <div id="s5" class="scene clip" data-composition-id="main" data-start="14.5" data-duration="3.5" style="visibility:hidden;">
    <div class="vignette"></div><div class="grain"></div>
    <div class="scene-content">
      <div id="s5-text" style="font-family:var(--f-body);font-weight:700;font-size:88px;color:var(--text);text-transform:uppercase;letter-spacing:0.04em;line-height:1.1;">${l3}</div>
    </div>
  </div>

  <!-- S6: IMPACT (anchor, 18–21s) -->
  <div id="s6" class="scene clip" data-composition-id="main" data-start="18" data-duration="3" style="opacity:0;">
    <div class="vignette"></div><div class="grain"></div>
    <div class="scene-content">
      <div id="s6-impact" style="font-family:var(--f-title);font-weight:900;font-size:110px;color:var(--gold);text-transform:uppercase;letter-spacing:0.08em;line-height:1.0;">${impact}</div>
    </div>
  </div>

  <!-- S7: CTA (non-anchor, 21–26s) -->
  <div id="s7" class="scene clip" data-composition-id="main" data-start="21" data-duration="5" style="visibility:hidden;">
    <div class="vignette"></div><div class="grain"></div>
    <div class="scene-content">
      <div id="s7-logo" style="font-family:var(--f-title);font-size:32px;color:var(--accent);letter-spacing:0.35em;text-transform:uppercase;margin-bottom:36px;">GLOBAL AI NEWS</div>
      <div id="s7-cta" style="font-family:var(--f-body);font-weight:300;font-size:34px;color:rgba(255,255,255,0.75);letter-spacing:0.2em;text-transform:uppercase;">${cta}</div>
      <div id="s7-rule" style="height:1px;background:rgba(255,255,255,0.25);margin:28px auto 0;width:0;max-width:280px;"></div>
    </div>
  </div>

  <script>
    (function () {
      var tl = gsap.timeline();

      // S1: PRESENTS (0–3s, anchor)
      tl.set("#s1", { opacity: 1 }, 0);
      tl.from("#s1-brand",    { autoAlpha: 0, y: 12, duration: 1.0, ease: "power2.out" }, 0.2);
      tl.from("#s1-presents", { autoAlpha: 0,         duration: 0.8, ease: "power2.out" }, 0.7);
      tl.from("#s1-ol",       { autoAlpha: 0, y:  8,  duration: 0.9, ease: "power2.out" }, 1.1);
      tl.to(  "#s1-rule",     { width: 160,            duration: 0.7, ease: "expo.out"   }, 1.6);

      // S2: HEADLINE (3–7.5s, non-anchor)
      tl.set("#s2", { autoAlpha: 1 }, 3);
      ${wordAnimations}
      tl.to("#s2-rule", { width: 220, duration: 0.7, ease: "expo.out" }, ${ruleStart});
      tl.set("#s2", { autoAlpha: 0 }, 7.5);

      // S3: LINE 1 (7.5–11s, anchor group 2)
      tl.set("#s3", { opacity: 1 }, 7.5);
      tl.from("#s3-text", { x: -100, autoAlpha: 0, duration: 0.35, ease: "power4.out" }, 7.6);
      tl.to(  "#s3-text", { color: "#cc1a1a",      duration: 0.4,  ease: "power2.inOut" }, 9.8);

      // S4: LINE 2 (11–14.5s, non-anchor)
      tl.set("#s4", { autoAlpha: 1 }, 11);
      tl.from("#s4-text", { x: 100, autoAlpha: 0, duration: 0.35, ease: "power4.out" }, 11.1);
      tl.set("#s4", { autoAlpha: 0 }, 14.5);

      // S5: LINE 3 (14.5–18s, non-anchor)
      tl.set("#s5", { autoAlpha: 1 }, 14.5);
      tl.from("#s5-text", { scale: 1.08, autoAlpha: 0, duration: 0.45, ease: "power3.out" }, 14.6);
      tl.to(  "#s5-text", { y: -8,                    duration: 1.6,  ease: "sine.inOut", yoyo: true, repeat: 1 }, 15.8);
      tl.set("#s5", { autoAlpha: 0 }, 18);

      // S6: IMPACT (18–21s, anchor group 3)
      tl.set("#s6", { opacity: 1 }, 18);
      tl.from("#s6-impact", { scale: 0.82, autoAlpha: 0, duration: 0.4, ease: "back.out(1.6)" }, 18.1);
      tl.to(  "#s6-impact", { opacity: 0.6,              duration: 0.5, ease: "power2.inOut", yoyo: true, repeat: 1 }, 19.5);

      // S7: CTA (21–26s, non-anchor)
      tl.set("#s7", { autoAlpha: 1 }, 21);
      tl.from("#s7-logo", { autoAlpha: 0, y: -18, duration: 0.9, ease: "power3.out" }, 21.2);
      tl.from("#s7-cta",  { autoAlpha: 0, y:  18, duration: 0.9, ease: "power3.out" }, 21.9);
      tl.to(  "#s7-rule", { width: 280,            duration: 1.1, ease: "expo.out"   }, 22.6);
      tl.to(  "#s7-logo", { y: -6,                 duration: 1.5, ease: "sine.inOut", yoyo: true, repeat: 1 }, 23.8);

      window.__timelines = {};
      window.__timelines["main"] = tl;

      HyperShader.init({
        scenes: ["s1", "s3", "s6"],
        transitions: [
          { type: "chromatic-split",    time: 7.25,  duration: 0.5 },
          { type: "flash-through-white", time: 17.75, duration: 0.5 }
        ]
      });
    })();
  </script>
</body>
</html>`;
}

async function generateTrailerForPost(post: any): Promise<string> {
  const trailerDir = path.join(process.cwd(), 'public', 'trailers', `post-${post.id}`);
  const trailerUrl = `/trailers/post-${post.id}/preview.html`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `You are writing copy for a short cinematic film trailer for this AI news article.
Extract exactly:
- opening_line: A dramatic 3-5 word hook (e.g. "The future is now")
- headline: The core topic, 4-7 punchy words
- line1: First trailer line, max 8 words, dramatic present tense
- line2: Second line, max 8 words, builds tension
- line3: Climactic statement, max 8 words, leaves audience wanting more
- impact: One impactful phrase or stat, max 6 words (e.g. "A $2 Trillion Revolution")
- cta: Call to action line, e.g. "The full story awaits"

Article title: ${post.title}
Article content: ${post.content.substring(0, 600)}

Return as JSON only.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          opening_line: { type: Type.STRING },
          headline:     { type: Type.STRING },
          line1:        { type: Type.STRING },
          line2:        { type: Type.STRING },
          line3:        { type: Type.STRING },
          impact:       { type: Type.STRING },
          cta:          { type: Type.STRING }
        },
        required: ['opening_line', 'headline', 'line1', 'line2', 'line3', 'impact', 'cta']
      }
    }
  });

  const content: TrailerContent = JSON.parse(response.text || '{}');
  if (!content.headline) throw new Error('Gemini returned empty trailer content');

  fs.mkdirSync(trailerDir, { recursive: true });
  fs.writeFileSync(path.join(trailerDir, 'index.html'), buildTrailerHTML(content));
  fs.writeFileSync(path.join(trailerDir, 'preview.html'), PREVIEW_HTML);
  db.prepare('UPDATE posts SET trailer_path = ? WHERE id = ?').run(trailerUrl, post.id);

  return trailerUrl;
}

// ── RSS Feeds ────────────────────────────────────────────────────────────────

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
  app.use(express.static(path.join(process.cwd(), 'public')));
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

  app.get('/api/posts/:id/trailer', async (req: any, res) => {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (post.trailer_path) {
      const fullPath = path.join(process.cwd(), 'public', post.trailer_path.replace(/^\//, ''));
      if (fs.existsSync(fullPath)) return res.json({ trailerUrl: post.trailer_path });
    }

    try {
      const trailerUrl = await generateTrailerForPost(post);
      res.json({ trailerUrl });
    } catch (e) {
      console.error('Trailer generation failed:', e);
      res.status(500).json({ error: 'Failed to generate trailer' });
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
