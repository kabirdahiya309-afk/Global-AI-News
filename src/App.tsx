import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import Markdown from 'react-markdown';
import { Mail, MapPin, Sparkles, Globe, ChevronRight, Loader2, Lock, User, Star, ShieldCheck } from 'lucide-react';

interface Post {
  id: number;
  title: string;
  content: string;
  image_url: string;
  location_name: string;
  lat: number;
  lng: number;
  created_at: string;
  is_premium: number;
  locked?: boolean;
}

interface UserData {
  id: number;
  email: string;
  tier: 'free' | 'basic' | 'premium';
  interests: string[];
  language: string;
}

export default function App() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [subscribeStatus, setSubscribeStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [subscribeMessage, setSubscribeMessage] = useState('');
  const [generating, setGenerating] = useState(false);

  const [user, setUser] = useState<UserData | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  
  const [authForm, setAuthForm] = useState({ email: '', password: '', interests: '', language: navigator.language });

  useEffect(() => {
    if (token) {
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (data.user) setUser(data.user);
          else { setToken(null); localStorage.removeItem('token'); }
        })
        .catch(() => { setToken(null); localStorage.removeItem('token'); });
    }
  }, [token]);

  useEffect(() => {
    fetchPosts();
  }, [user]); // Refetch when user changes (for personalization)

  const fetchPosts = async () => {
    setLoading(true);
    try {
      const headers: any = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const lang = user?.language || navigator.language;
      const res = await fetch(`/api/posts?lang=${lang}`, { headers });
      const data = await res.json();
      setPosts(data);
    } catch (error) {
      console.error('Failed to fetch posts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload = authMode === 'login' 
        ? { email: authForm.email, password: authForm.password }
        : { ...authForm, interests: authForm.interests.split(',').map(i => i.trim()).filter(Boolean) };
        
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setToken(data.token);
        localStorage.setItem('token', data.token);
        setUser(data.user);
        setShowAuthModal(false);
      } else {
        alert(data.error);
      }
    } catch (e) {
      alert('Authentication failed');
    }
  };

  const handleUpgrade = async (tier: string) => {
    if (!user) {
      setShowPricingModal(false);
      setShowAuthModal(true);
      return;
    }
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tier })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        setUser({ ...user, tier: tier as any });
        setShowPricingModal(false);
      }
    } catch (e) {
      alert('Upgrade failed');
    }
  };

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubscribeStatus('loading');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubscribeStatus('success');
        setSubscribeMessage('Successfully subscribed!');
        setEmail('');
      } else {
        setSubscribeStatus('error');
        setSubscribeMessage(data.error || 'Failed to subscribe');
      }
    } catch (error) {
      setSubscribeStatus('error');
      setSubscribeMessage('An error occurred');
    }
  };

  const triggerGeneration = async () => {
    setGenerating(true);
    try {
      await fetch('/api/admin/generate', { method: 'POST' });
      alert('Generation started in the background. Refresh in a few minutes.');
    } catch (error) {
      console.error('Failed to trigger generation', error);
    } finally {
      setGenerating(false);
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-zinc-900 text-white p-2 rounded-lg">
              <Sparkles className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Global AI News</h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowPricingModal(true)}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              <Star className="w-4 h-4" /> Upgrade
            </button>
            <div className="flex items-center gap-1 text-sm text-zinc-500 bg-zinc-100 px-3 py-1.5 rounded-full">
              <Globe className="w-4 h-4" />
              <span>{user?.language || navigator.language}</span>
            </div>
            {user ? (
              <div className="flex items-center gap-3">
                <div className="text-sm font-medium px-2 py-1 bg-zinc-100 rounded flex items-center gap-1">
                  <User className="w-4 h-4" /> {user.tier.toUpperCase()}
                </div>
                <button onClick={logout} className="text-sm text-zinc-500 hover:text-zinc-800">Logout</button>
              </div>
            ) : (
              <button onClick={() => setShowAuthModal(true)} className="text-sm font-medium bg-zinc-900 text-white px-4 py-1.5 rounded-full hover:bg-zinc-800">
                Sign In
              </button>
            )}
            <button 
              onClick={triggerGeneration}
              disabled={generating}
              className="text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-600 px-3 py-1.5 rounded-md transition-colors flex items-center gap-1 hidden sm:flex"
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              Force Generate
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex flex-col lg:flex-row gap-12">
        {/* Main Content */}
        <div className="lg:w-2/3 space-y-12">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 space-y-4 text-zinc-400">
              <Loader2 className="w-8 h-8 animate-spin" />
              <p>Personalizing your AI news feed...</p>
            </div>
          ) : posts.length === 0 ? (
            <div className="bg-white p-12 rounded-2xl border border-zinc-200 text-center">
              <Sparkles className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">No news generated yet</h2>
              <p className="text-zinc-500 mb-6">The autonomous agent is gathering the latest AI news. Please check back shortly.</p>
              <button 
                onClick={triggerGeneration}
                className="bg-zinc-900 text-white px-6 py-2 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Trigger Generation
              </button>
            </div>
          ) : (
            <>
              {/* Hero Post */}
              {posts[0] && (
                <article className="bg-white rounded-3xl overflow-hidden border border-zinc-200 shadow-sm group relative">
                  {posts[0].is_premium ? (
                    <div className="absolute top-4 left-4 z-10 bg-indigo-600 text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1 shadow-md">
                      <Star className="w-3 h-3" /> PREMIUM REPORT
                    </div>
                  ) : null}
                  {posts[0].image_url && !posts[0].locked && (
                    <div className="aspect-video w-full overflow-hidden bg-zinc-100">
                      <img 
                        src={posts[0].image_url} 
                        alt={posts[0].title} 
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}
                  <div className="p-8">
                    <div className="flex items-center gap-4 text-sm text-zinc-500 mb-4">
                      <time dateTime={posts[0].created_at}>
                        {format(new Date(posts[0].created_at), 'MMMM d, yyyy')}
                      </time>
                      {posts[0].location_name && (
                        <div className="flex items-center gap-1">
                          <MapPin className="w-4 h-4" />
                          <span>{posts[0].location_name}</span>
                        </div>
                      )}
                    </div>
                    <h2 className="text-3xl font-bold tracking-tight mb-4 leading-tight">
                      {posts[0].title}
                    </h2>
                    {posts[0].locked ? (
                      <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-8 text-center">
                        <Lock className="w-8 h-8 text-zinc-400 mx-auto mb-3" />
                        <h3 className="text-lg font-semibold mb-2">Premium Content Locked</h3>
                        <p className="text-zinc-500 mb-4">{posts[0].content}</p>
                        <button onClick={() => setShowPricingModal(true)} className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-indigo-700">
                          Upgrade to Premium
                        </button>
                      </div>
                    ) : (
                      <div className="prose prose-zinc max-w-none prose-p:leading-relaxed prose-headings:font-semibold">
                        <Markdown>{posts[0].content}</Markdown>
                      </div>
                    )}
                  </div>
                </article>
              )}

              {/* Older Posts Grid */}
              {posts.length > 1 && (
                <div className="grid md:grid-cols-2 gap-8">
                  {posts.slice(1).map((post) => (
                    <article key={post.id} className="bg-white rounded-2xl overflow-hidden border border-zinc-200 shadow-sm flex flex-col relative">
                      {post.is_premium ? (
                        <div className="absolute top-3 left-3 z-10 bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-md">
                          <Star className="w-3 h-3" /> PREMIUM
                        </div>
                      ) : null}
                      {post.image_url && !post.locked && (
                        <div className="aspect-video w-full overflow-hidden bg-zinc-100">
                          <img 
                            src={post.image_url} 
                            alt={post.title} 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}
                      <div className="p-6 flex-1 flex flex-col">
                        <div className="flex items-center gap-3 text-xs text-zinc-500 mb-3">
                          <time dateTime={post.created_at}>
                            {format(new Date(post.created_at), 'MMM d, yyyy')}
                          </time>
                          {post.location_name && (
                            <div className="flex items-center gap-1 truncate">
                              <MapPin className="w-3 h-3" />
                              <span className="truncate">{post.location_name}</span>
                            </div>
                          )}
                        </div>
                        <h3 className="text-xl font-bold tracking-tight mb-3 line-clamp-2">
                          {post.title}
                        </h3>
                        {post.locked ? (
                          <div className="flex-1 flex flex-col items-center justify-center text-center bg-zinc-50 rounded-lg p-4 border border-zinc-100 mb-4">
                            <Lock className="w-5 h-5 text-zinc-400 mb-2" />
                            <p className="text-sm text-zinc-500">Premium Analysis</p>
                          </div>
                        ) : (
                          <div className="prose prose-sm prose-zinc line-clamp-3 mb-4 flex-1">
                            <Markdown>{post.content}</Markdown>
                          </div>
                        )}
                        <button 
                          onClick={() => post.locked ? setShowPricingModal(true) : null}
                          className="text-sm font-medium text-zinc-900 flex items-center gap-1 hover:text-zinc-600 transition-colors mt-auto"
                        >
                          {post.locked ? 'Unlock Story' : 'Read full story'} <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Sidebar */}
        <aside className="lg:w-1/3 space-y-8">
          {/* Newsletter Widget */}
          <div className="bg-zinc-900 text-white rounded-3xl p-8 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
              <Mail className="w-32 h-32" />
            </div>
            <div className="relative z-10">
              <h3 className="text-2xl font-bold mb-2">Stay Ahead</h3>
              <p className="text-zinc-400 mb-6 text-sm leading-relaxed">
                Get the latest AI breakthroughs and global news delivered straight to your inbox.
              </p>
              <form onSubmit={handleSubscribe} className="space-y-3">
                <div>
                  <input
                    type="email"
                    required
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                  />
                </div>
                <button
                  type="submit"
                  disabled={subscribeStatus === 'loading'}
                  className="w-full bg-white text-zinc-900 font-semibold py-3 rounded-xl hover:bg-zinc-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {subscribeStatus === 'loading' ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Subscribe Now'}
                </button>
                {subscribeMessage && (
                  <p className={`text-sm text-center ${subscribeStatus === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {subscribeMessage}
                  </p>
                )}
              </form>
            </div>
          </div>

          {/* Ad Placeholder 1 (Hidden for Basic/Premium) */}
          {(!user || user.tier === 'free') && (
            <div className="bg-zinc-100 rounded-2xl border border-zinc-200 p-6 flex flex-col items-center justify-center min-h-[300px] text-zinc-400 text-sm">
              <span className="uppercase tracking-widest text-xs font-semibold mb-2">Advertisement</span>
              <div className="w-full h-48 bg-zinc-200 rounded-lg flex items-center justify-center border border-zinc-300 border-dashed">
                Ad Space (300x250)
              </div>
              <button onClick={() => setShowPricingModal(true)} className="mt-4 text-xs text-indigo-600 hover:underline">Remove Ads</button>
            </div>
          )}

          {/* About Widget */}
          <div className="bg-white rounded-2xl border border-zinc-200 p-6">
            <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-zinc-400" />
              About This Blog
            </h3>
            <p className="text-sm text-zinc-600 leading-relaxed">
              This platform is fully autonomous. An AI agent continuously monitors global news sources, researches breakthroughs, writes articles, and generates accompanying artwork without human intervention.
            </p>
          </div>
          
          {/* Ad Placeholder 2 (Hidden for Basic/Premium) */}
          {(!user || user.tier === 'free') && (
            <div className="bg-zinc-100 rounded-2xl border border-zinc-200 p-6 flex flex-col items-center justify-center min-h-[600px] text-zinc-400 text-sm">
              <span className="uppercase tracking-widest text-xs font-semibold mb-2">Advertisement</span>
              <div className="w-full h-full min-h-[500px] bg-zinc-200 rounded-lg flex items-center justify-center border border-zinc-300 border-dashed">
                Ad Space (300x600)
              </div>
            </div>
          )}
        </aside>
      </main>

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full relative">
            <button onClick={() => setShowAuthModal(false)} className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600">✕</button>
            <h2 className="text-2xl font-bold mb-6">{authMode === 'login' ? 'Sign In' : 'Create Account'}</h2>
            <form onSubmit={handleAuth} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Email</label>
                <input type="email" required value={authForm.email} onChange={e => setAuthForm({...authForm, email: e.target.value})} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Password</label>
                <input type="password" required value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900" />
              </div>
              {authMode === 'register' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Interests (comma separated)</label>
                    <input type="text" placeholder="e.g. LLMs, Robotics, Ethics" value={authForm.interests} onChange={e => setAuthForm({...authForm, interests: e.target.value})} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Preferred Language Code</label>
                    <input type="text" placeholder="e.g. en, es, fr" value={authForm.language} onChange={e => setAuthForm({...authForm, language: e.target.value})} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900" />
                  </div>
                </>
              )}
              <button type="submit" className="w-full bg-zinc-900 text-white font-semibold py-2.5 rounded-lg hover:bg-zinc-800 transition-colors">
                {authMode === 'login' ? 'Sign In' : 'Register'}
              </button>
            </form>
            <div className="mt-4 text-center text-sm text-zinc-600">
              {authMode === 'login' ? "Don't have an account? " : "Already have an account? "}
              <button onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} className="text-indigo-600 font-medium hover:underline">
                {authMode === 'login' ? 'Register' : 'Sign In'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pricing Modal */}
      {showPricingModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-4xl w-full relative max-h-[90vh] overflow-y-auto">
            <button onClick={() => setShowPricingModal(false)} className="absolute top-6 right-6 text-zinc-400 hover:text-zinc-600">✕</button>
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold mb-4">Upgrade Your AI Intelligence</h2>
              <p className="text-zinc-500 max-w-xl mx-auto">Get personalized insights, ad-free reading, and exclusive deep-dive reports generated by our autonomous AI agents.</p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-6">
              {/* Free Tier */}
              <div className="border border-zinc-200 rounded-2xl p-6 flex flex-col">
                <h3 className="text-xl font-bold mb-2">Free</h3>
                <div className="text-3xl font-bold mb-6">$0<span className="text-lg text-zinc-500 font-normal">/mo</span></div>
                <ul className="space-y-3 mb-8 flex-1">
                  <li className="flex items-center gap-2 text-sm text-zinc-600"><ShieldCheck className="w-4 h-4 text-emerald-500" /> Standard AI News</li>
                  <li className="flex items-center gap-2 text-sm text-zinc-600"><ShieldCheck className="w-4 h-4 text-emerald-500" /> Newsletter Access</li>
                  <li className="flex items-center gap-2 text-sm text-zinc-400 line-through">Ad-Free Experience</li>
                  <li className="flex items-center gap-2 text-sm text-zinc-400 line-through">Personalized Feed</li>
                  <li className="flex items-center gap-2 text-sm text-zinc-400 line-through">Premium Reports</li>
                </ul>
                <button disabled className="w-full bg-zinc-100 text-zinc-500 font-semibold py-2.5 rounded-lg">Current Plan</button>
              </div>

              {/* Basic Tier */}
              <div className="border-2 border-indigo-600 rounded-2xl p-6 flex flex-col relative">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-indigo-600 text-white text-xs font-bold px-3 py-1 rounded-full">RECOMMENDED</div>
                <h3 className="text-xl font-bold mb-2">Basic</h3>
                <div className="text-3xl font-bold mb-6">$5<span className="text-lg text-zinc-500 font-normal">/mo</span></div>
                <ul className="space-y-3 mb-8 flex-1">
                  <li className="flex items-center gap-2 text-sm text-zinc-600"><ShieldCheck className="w-4 h-4 text-emerald-500" /> Standard AI News</li>
                  <li className="flex items-center gap-2 text-sm text-zinc-600"><ShieldCheck className="w-4 h-4 text-emerald-500" /> Newsletter Access</li>
                  <li className="flex items-center gap-2 text-sm text-zinc-600"><ShieldCheck className="w-4 h-4 text-emerald-500" /> Ad-Free Experience</li>
                  <li className="flex items-center gap-2 text-sm text-zinc-600"><ShieldCheck className="w-4 h-4 text-emerald-500" /> Personalized Feed</li>
                  <li className="flex items-center gap-2 text-sm text-zinc-400 line-through">Premium Reports</li>
                </ul>
                <button onClick={() => handleUpgrade('basic')} className="w-full bg-indigo-600 text-white font-semibold py-2.5 rounded-lg hover:bg-indigo-700 transition-colors">Upgrade to Basic</button>
              </div>

              {/* Premium Tier */}
              <div className="bg-zinc-900 text-white rounded-2xl p-6 flex flex-col">
                <h3 className="text-xl font-bold mb-2">Premium</h3>
                <div className="text-3xl font-bold mb-6">$15<span className="text-lg text-zinc-400 font-normal">/mo</span></div>
                <ul className="space-y-3 mb-8 flex-1">
                  <li className="flex items-center gap-2 text-sm text-zinc-300"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Standard AI News</li>
                  <li className="flex items-center gap-2 text-sm text-zinc-300"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Newsletter Access</li>
                  <li className="flex items-center gap-2 text-sm text-zinc-300"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Ad-Free Experience</li>
                  <li className="flex items-center gap-2 text-sm text-zinc-300"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Personalized Feed</li>
                  <li className="flex items-center gap-2 text-sm text-zinc-300"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Premium Reports</li>
                  <li className="flex items-center gap-2 text-sm text-zinc-300"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Priority Support</li>
                </ul>
                <button onClick={() => handleUpgrade('premium')} className="w-full bg-white text-zinc-900 font-semibold py-2.5 rounded-lg hover:bg-zinc-100 transition-colors">Upgrade to Premium</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-zinc-200 py-12 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-zinc-900">
            <Sparkles className="w-5 h-5" />
            <span className="font-bold tracking-tight">Global AI News</span>
          </div>
          <p className="text-sm text-zinc-500">
            &copy; {new Date().getFullYear()} Autonomous AI Agent. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
